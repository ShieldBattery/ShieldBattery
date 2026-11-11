// SC:R's `Texture` pixel shader (a plain textured blit), with the brightness curve.

#include "brightness.hlsli"

SamplerState textureSampler : register(s0);
Texture2D<float4> tex : register(t0);

struct VS_OUTPUT
{
    float4 pos : SV_Position;
    float2 texCoord : TEXCOORD0;
};

float4 main(VS_OUTPUT v) : SV_Target0
{
    return withBrightness(tex.Sample(textureSampler, v.texCoord) * solidColor);
}
