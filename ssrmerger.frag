#ifdef FINAL
    uniform sampler2D m_Scene;
#endif

uniform sampler2D m_SSR;

uniform vec2 g_Resolution;
uniform float m_Size;

noperspective in vec2 texCoord;
out vec4 outFragColor;
// https://github.com/Jam3/glsl-fast-gaussian-blur
vec4 blur9(sampler2D image, vec2 uv, vec2 resolution, vec2 direction) {
  vec4 color = vec4(0.0);
  vec2 off1 = vec2(1.3846153846) * direction;
  vec2 off2 = vec2(3.2307692308) * direction;
  color += texture(image, uv) * 0.2270270270;
  color += texture(image, uv + (off1 / resolution)) * 0.3162162162;
  color += texture(image, uv - (off1 / resolution)) * 0.3162162162;
  color += texture(image, uv + (off2 / resolution)) * 0.0702702703;
  color += texture(image, uv - (off2 / resolution)) * 0.0702702703;
  return color;
}

void main(){
    vec2 texCoord=texCoord;
    #ifdef HORIZONTAL
        vec4 sum=blur9(m_SSR,texCoord,g_Resolution,vec2(1*m_Size,0));
    #else
        vec4 sum=blur9(m_SSR,texCoord,g_Resolution,vec2(0,1*m_Size));
    #endif
    #ifdef FINAL
        outFragColor=texture(m_Scene,texCoord);
        outFragColor.rgb=mix(outFragColor.rgb,sum.rgb,sum.a);
    #else
        outFragColor=sum;
    #endif
}
