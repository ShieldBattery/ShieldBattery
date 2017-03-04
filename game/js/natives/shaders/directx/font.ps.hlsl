Texture2D atlas : register(t0);

struct PS_Input {
  float4 pos : SV_POSITION;
  float2 texcoord : TEXCOORD0;
};

float4 PS_Main(PS_Input frag) : SV_TARGET {
  // TODO(tec27): colorize the text
  return atlas.Load(int3(frag.texcoord.xy, 0));
}
