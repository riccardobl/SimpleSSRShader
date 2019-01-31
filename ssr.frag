/**
#######################
# Simple SSR shader 
#######################

Copyright (c) 2019, Riccardo Balbo
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

/// ########### SETTINGS (most of these are setted by the material) ###########
////
//// # GENERAL
//// Use dFdx and dFdy instead of multiple samples
#define FAST_APPROXIMATIONS 1
//// Read only XY from normal map and generate Z
// #define RG_NORMAL_MAP 1
//// Read glossiness from Z component of the normal map (works with RG_NORMAL_MAP)
// #define GLOSSINESS_PACKET_IN_NORMAL_B 1
//// Aproximate surface normals from the depth buffer
// #define USE_APPROXIMATED_NORMALS 1
//// Approximate glossiness from the normal map
// #define USE_APPROXIMATED_GLOSSINESS 1
////
//// # RAYMARCHING
//// How many samples along the ray
// #define RAY_SAMPLES 16
//// How many samples around the hit position
// #define NEARBY_SAMPLES 4 // 0 to 4 , 0 to disable
//// Length of first sample in world space
#define INITIAL_STEP_LENGTH 1
//// Size of a pixel used by NEARBY_SAMPLES
#define PIXEL_SIZE_MULT 1.
//// A depth difference equals or below this will be considered 0
#define DEPTH_TEST_BIAS 0.0001
////
//// # DEBUG
// #define _ENABLE_TESTS 1
// #define _TEST_CONVERSIONS 1
// #define _TEST_SHOW_WPOS 1
// #define _TEST_SHOW_SCREEN_Z 1
// #define _TEST_SHOW_LINEAR_Z 1
// #define _TEST_SHOW_APROXIMATED_GLOSS 1
// #define _TEST_SHOW_RAY_GLOSS
///// ########### ########### ########### 


#ifndef SCENE_NORMALS
    // If normal map is not provided, fallback to normal approximation
    #define USE_APPROXIMATED_NORMALS 1
    #undef USE_APPROXIMATED_GLOSSINESS
#else 
    uniform sampler2D m_SceneNormals;
#endif

#if defined(RG_NORMAL_MAP) && !defined(GLOSSINESS_PACKET_IN_NORMAL_B)
    // If glossiness is not provided, fallback to glossiness approximation
    #define USE_APPROXIMATED_GLOSSINESS 1
#endif

#if NEARBY_SAMPLES>0
    const vec2 _SAMPLES[4]=vec2[](
        vec2(1.0f, 0.0f), 
        vec2(-1.0f, 0.0f), 
        vec2(0.0f, 1.0f), 
        vec2(0.0f, -1.0f)
    );
#endif

noperspective in vec2 texCoord;
out vec4 outFragColor;

uniform vec2 g_ResolutionInverse;
uniform sampler2D m_SceneDepth;
uniform sampler2D m_Scene;
uniform vec3 m_CameraPosition;
uniform mat4 m_SceneViewProjectionMatrixInverse;
uniform mat4 m_SceneViewProjectionMatrix;
uniform vec2 m_FrustumNearFar;
uniform vec2 m_NearReflectionsFade;
uniform vec2 m_FarReflectionsFade;


/**
* In this shader we use two types of coordinates
* World coordinates = coordinates of a point in the 3d world
* Screen coordinates = coordinate of a point projected to the screen 
*        x=(0,1) for left and right 
*        y=(0,1) for bottom and top
*        z=(0,1) for near and far
*/

/**
* Represent a ray
*/
struct Ray {
    // World position of the surface from where the ray is originated
    vec3 wFrom;
    // Same as before but in screenspace
    vec3 sFrom;
    // Glossiness of the surface from where the ray is originated
    float surfaceGlossiness;
    // Its direction
    vec3 wDir;
    // The size of one pixel
    vec2 pixelSize;
};

/**
* Returned when the ray hit or miss the scene
*/
struct HitResult {
    // Last tested screen position (-1,-1 if missed)
    vec3 screenPos;
    // How strong the reflection is
    float reflStrength;
};

/**
* Get screen space coordinates
*        x=(0,1) for left and right 
*        y=(0,1) for bottom and top
*        z=(0,1) for near and far
*/
vec3 getScreenPos(in vec2 texCoord,in float depth){
    vec3 screenpos= vec3(texCoord,depth);
    return screenpos;
}

/**
* Exponential to linear depth
*/
float linearizeDepth(in float depth){
    float f=m_FrustumNearFar.y;
    float n = m_FrustumNearFar.x;
    return (2 * n) / (f + n - depth * (f - n));
}

/**
* Convert world space to screenspace (UV,DEPTH)
*/
vec3 wposToScreenPos(in vec3 wPos){
    vec4 ww = m_SceneViewProjectionMatrix * vec4(wPos, 1.0);
    ww.xyz /= ww.w;
    ww.xyz = ww.xyz * 0.5 + 0.5;
    return ww.xyz;
}

/**
* Convert screen space (UV,DEPTH) to world space
*/
vec3 screenPosToWPos(in vec3 screenPos){
    vec4 pos=vec4(screenPos,1.0)*2.0-1.0;
    pos = m_SceneViewProjectionMatrixInverse * pos;
    return pos.xyz/=pos.w;
}


#ifdef USE_APPROXIMATED_NORMALS
    /**
    * Use nearby positions to aproximate normals
    */
    // Adapted from https://github.com/jMonkeyEngine/jmonkeyengine/blob/master/jme3-effects/src/main/resources/Common/MatDefs/SSAO/ssao.frag#L33
    vec3 approximateNormal(in sampler2D sceneDepth,in vec2 pixelSize,in vec3 pos,in vec2 texCoord){
        #ifdef FAST_APPROXIMATIONS
            vec3 v1=dFdx(pos);
            vec3 v2=dFdy(pos);
        #else
            float step = pixelSize.x ;
            float stepy = pixelSize.y ;
            float depth2 = texture(sceneDepth,texCoord + vec2(step,-stepy)).r;
            float depth3 = texture(sceneDepth,texCoord + vec2(-step,-stepy)).r;
            vec3 pos2=screenPosToWPos( getScreenPos(texCoord + vec2(step,-stepy),depth2) );
            vec3 pos3=screenPosToWPos( getScreenPos(texCoord + vec2(-step,-stepy),depth3) );
            vec3 v1 = (pos - pos2).xyz;
            vec3 v2 = (pos3 - pos2).xyz;              
        #endif
        return normalize(cross(-v1, v2));
    }
#endif

#ifdef USE_APPROXIMATED_GLOSSINESS
    /**
    * Use nearby normals to aproximate glossiness
    */
    float approximateGlossiness(in sampler2D normalMap,in vec2 pixelSize,in vec3 normal,in vec2 texCoord){
        vec3 d1 = dFdx(normal);
        vec3 d2 = dFdy(normal);
        float maxd=max(dot(d1,d1),dot(d2,d2));
        maxd=smoothstep(0.,1.,maxd);
        maxd=pow(maxd,8)*1.;
        return 1.-clamp(maxd,0,1);
    }
#endif

// ##### DEBUG
#ifdef _ENABLE_TESTS
    void _testConversions(){
        float depth=texture(m_SceneDepth,texCoord).r;
        vec3 screenpos=getScreenPos(texCoord.xy,depth);            
        vec3 wpos=screenPosToWPos(screenpos);
        screenpos=wposToScreenPos(wpos);          
        vec3 nwpos=screenPosToWPos(screenpos);  
        if(distance(nwpos,wpos)>0.01)outFragColor=vec4(1,0,0,1);
    }
    void _testShowWPos(){
        float depth=texture(m_SceneDepth,texCoord).r;
        vec3 screenpos=getScreenPos(texCoord.xy,depth);
        vec3 wpos=screenPosToWPos(screenpos);
        outFragColor.rgb=wpos;
    }
    void _testScreenZ(){
        float depth=texture(m_SceneDepth,texCoord).r;
        vec3 screenpos=getScreenPos(texCoord.xy,depth);
        outFragColor.rgb=vec3(screenpos.z);
    }
    void _testLinearZ(){
        float depth=texture(m_SceneDepth,texCoord).r;
        vec3 screenpos=getScreenPos(texCoord.xy,depth);
        outFragColor.rgb=vec3(linearizeDepth(screenpos.z));
    }
    void _testShowApproximatedGloss(){
        vec3 wNormal=texture(m_SceneNormals,texCoord).rgb;
        wNormal.xyz=wNormal.xyz*2.-1.;
        #ifdef RG_NORMAL_MAP
            wNormal.z = sqrt(1-clamp(dot(wNormal.xy, wNormal.xy),0.,1.)); // Reconstruct Z
        #endif
        outFragColor.rgb=vec3(approximateGlossiness(m_SceneNormals,g_ResolutionInverse,wNormal,texCoord));
    }
    void _testShowRayGloss(in Ray ray){
        outFragColor.rgb=vec3(ray.surfaceGlossiness);
    }
#endif
// ####

/**
* Create a ray for ray marching
*/
Ray createRay(in vec2 texCoord,in float depth,in vec3 cameraPos,in vec2 pixelSize,
    #ifdef USE_APPROXIMATED_NORMALS
        in sampler2D sceneDepth
    #else
        in sampler2D sceneNormals
    #endif
){
    Ray ray;
    ray.sFrom=getScreenPos(texCoord,depth);
    ray.wFrom = screenPosToWPos(ray.sFrom);
    ray.surfaceGlossiness=1.;

    #ifdef USE_APPROXIMATED_NORMALS
        vec3 wNormal=approximateNormal(sceneDepth,pixelSize,ray.wFrom,texCoord);
    #else
        vec3 wNormal=texture(sceneNormals,texCoord).rgb;
        #ifdef RG_NORMAL_MAP
            #ifdef GLOSSINESS_PACKET_IN_NORMAL_B
                ray.surfaceGlossiness=wNormal.z;
            #endif
            wNormal.xy=wNormal.xy*2.-1.;
            wNormal.z = sqrt(1-clamp(dot(wNormal.xy, wNormal.xy),0.,1.)); // Reconstruct Z
        #else
            wNormal.xyz=wNormal.xyz*2.-1.;
        #endif
        wNormal=normalize(wNormal);
        #if defined(USE_APPROXIMATED_GLOSSINESS) 
            ray.surfaceGlossiness=min(ray.surfaceGlossiness,approximateGlossiness(sceneNormals,pixelSize,wNormal,texCoord));
        #endif
    #endif

    // direction from camera to fragment (in world space)
    vec3 wDir = normalize(ray.wFrom - cameraPos);

    // reflection vector
    ray.wDir = normalize(reflect(wDir, normalize(wNormal)));
    
    ray.pixelSize=pixelSize;
    return ray;
}

/**
* Actual ray marching happens here
*/
HitResult performRayMarching(in Ray ray,in sampler2D sceneDepth){

    HitResult result;
    result.screenPos=vec3(-1,-1,-1);

    // Current position of the sample along the ray
    vec3 sampleWPos;

    // Same of before, but in screen space
    vec3 sampleScreenPos;

    // Position of the nearest surface at the sample position (in screen space)
    vec3 hitSurfaceScreenPos;

    // Length of the next step
    float stepLength = INITIAL_STEP_LENGTH;

    float linearSourceDepth=linearizeDepth(ray.sFrom.z);

    for(int i = 0; i < RAY_SAMPLES; i++) {
        // if(hit)break;
        sampleWPos = ray.wFrom + ray.wDir * stepLength;
        sampleScreenPos = wposToScreenPos(sampleWPos);
           
        hitSurfaceScreenPos = getScreenPos(sampleScreenPos.xy,texture(sceneDepth, sampleScreenPos.xy).r);
        vec3 hitSurfaceWPos = screenPosToWPos(hitSurfaceScreenPos);
     
        int j=0;
        #if NEARBY_SAMPLES>0
        do{
        #endif
            // We need to linearize the depth to have consistent tests for distant samples
            float linearHitSurfaceDepth=linearizeDepth(hitSurfaceScreenPos.z);
            float linearSampleDepth=linearizeDepth(sampleScreenPos.z);
            bool hit=
                linearHitSurfaceDepth>linearSourceDepth // check if the thing we want to reflect is behind the source of the ray
                &&abs(linearSampleDepth - linearHitSurfaceDepth) < DEPTH_TEST_BIAS; // check if the ray is (~almost) hitting the surface          
            // if first hit (letting the cycle running helds to better performances than breaking it)
            if(hit&&result.screenPos.x==-1){
                result.screenPos=sampleScreenPos;
                // Fade distant reflections
                result.reflStrength=distance(hitSurfaceWPos,ray.wFrom);      
                result.reflStrength=smoothstep(m_NearReflectionsFade.x,m_NearReflectionsFade.y, result.reflStrength)
                *(1.-smoothstep(m_FarReflectionsFade.x,m_FarReflectionsFade.y, result.reflStrength));
            }
        #if NEARBY_SAMPLES>0
            hitSurfaceScreenPos = getScreenPos(sampleScreenPos.xy,
                texture(m_SceneDepth, sampleScreenPos.xy+_SAMPLES[j].xy *ray.pixelSize).r
            );
            j++;
        }while(j<=NEARBY_SAMPLES);
        #endif
                     
        // Compute next step length
        stepLength = length(ray.wFrom - hitSurfaceWPos);
    }
    return result;    
}


void main(){
    outFragColor=vec4(0);    

    float depth=texture(m_SceneDepth,texCoord).r;

    if(depth!=1){ // ignore the sky    

        // Build the ray
        #ifdef USE_APPROXIMATED_NORMALS
            Ray ray=createRay(texCoord,depth,m_CameraPosition,g_ResolutionInverse*PIXEL_SIZE_MULT,m_SceneDepth);
        #else 
            Ray ray=createRay(texCoord,depth,m_CameraPosition,g_ResolutionInverse*PIXEL_SIZE_MULT,m_SceneNormals);
        #endif

        // Perform ray marching
        HitResult result=performRayMarching(ray,m_SceneDepth);

        // Used to fade reflections near screen edges to remove artifacts
        float d=distance(result.screenPos.xy,vec2(0.5));
        d=pow(1.-clamp(d,0.,.5)*2.,2);
        
        // Render reflections
        if(result.screenPos.x!=-1){
            outFragColor.rgb=texture(m_Scene,result.screenPos.xy).rgb;
            outFragColor.a=d*ray.surfaceGlossiness*result.reflStrength;
        }  
 
        // Tests
        #ifdef _ENABLE_TESTS
            outFragColor=vec4(0,0,0,1);
            #ifdef _TEST_SHOW_WPOS
                _testShowWPos();
            #endif
            #ifdef _TEST_CONVERSIONS
                _testConversions();
            #endif  
            #ifdef _TEST_SHOW_SCREEN_Z
                _testScreenZ();
            #endif
            #ifdef _TEST_SHOW_LINEAR_Z
                _testLinearZ();
            #endif
            #ifdef _TEST_SHOW_APROXIMATED_GLOSS
                _testShowApproximatedGloss();
            #endif
            #ifdef _TEST_SHOW_RAY_GLOSS
                _testShowRayGloss(ray);
            #endif
        #endif

    }
}
