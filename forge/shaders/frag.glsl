#version 110

uniform sampler2D bw_screen;
uniform sampler2D palette;

varying vec2 texcoord;

void main() {
  vec4 color_index = texture2D(bw_screen, texcoord);
  vec4 texel = texture2D(palette, color_index.xy);
  gl_FragColor = texel;
}
