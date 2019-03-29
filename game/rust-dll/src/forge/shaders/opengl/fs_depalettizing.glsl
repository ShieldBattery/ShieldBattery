#version 140

uniform sampler2D bw_screen;
uniform sampler2D palette;

varying vec2 texcoord;

out vec4 color;

void main() {
  vec4 color_index = texture2D(bw_screen, texcoord);
  vec4 texel = texture2D(palette, color_index.xy);
  color = texel;
}
