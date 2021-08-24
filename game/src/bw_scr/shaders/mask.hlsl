struct VS_OUTPUT
{
    float4 pos : SV_POSITION;
    float2 texCoord : TEXCOORD0;
};

SamplerState maskSampler : register(s0);
Texture2D <float4> mask: register(t0);

struct PS_OUTPUT
{
    float4 frag_color : SV_Target0;
};

cbuffer constants
{
    // if 0, uses the normal BW behaviour where unexplored areas are black (For UMS),
    // otherwise makes unexplored areas somewhat visible as well.
    float useNewMask;
};

#define MAX_FOG_MASK 0.84
#define MIN_FOG_MASK 0.67

PS_OUTPUT main(VS_OUTPUT v)
{
    PS_OUTPUT o;
    float maskValue = mask.Sample(maskSampler, v.texCoord).x;
    if (useNewMask == 0.0)
    {
        o.frag_color = float4(0.0, 0.0, 0.0, maskValue);
    }
    else
    {
        // We calculate the fog mask as a piecewise function:
        //  - For the low parts (below MIN_FOG_MASK) we leave the linear function intact
        float lowMaskValue = min(maskValue, MIN_FOG_MASK);
        //  - For high parts (above MIN_FOG_MASK), we compress the range into
        //    (MIN_FOG_MASK, MAX_FOG_MASK) and increase the contrast in the transition (to better
        //    separate unexplored from explored fog areas)
        float highMaskValue = tanh(max(maskValue - MIN_FOG_MASK, 0.0) / (1.0 - MIN_FOG_MASK) * 4) *
            (MAX_FOG_MASK - MIN_FOG_MASK);
        maskValue = lowMaskValue + highMaskValue;
        o.frag_color = float4(
            0.0,
            0.0,
            0.0,
            maskValue);
    }
    return o;
}

