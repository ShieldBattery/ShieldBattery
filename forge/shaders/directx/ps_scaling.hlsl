Texture2D<float4> rendered_texture : register(t0);
SamplerState ss : register(s0);

struct PS_Input
{
  float4 pos : SV_POSITION;
  float2 texcoord : TEXCOORD0;
};

float4 PS_Main(PS_Input frag) : SV_TARGET
{
  return rendered_texture.Sample(ss, frag.texcoord);
}
