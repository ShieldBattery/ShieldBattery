#version 140

out vec4 color;

uniform sampler2D rendered_texture;

in vec2 texcoord;

void main() {
  color = texture(rendered_texture, texcoord);
}
