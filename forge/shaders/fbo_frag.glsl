#version 330

out vec4 color;

uniform sampler2D renderedTexture;

in vec2 texcoord;

void main(){
  color = texture(renderedTexture, texcoord);
}
