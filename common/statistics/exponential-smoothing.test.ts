import { ExponentialSmoothValue } from './exponential-smoothing'

describe('common/statistics/exponential-smoothing', () => {
  test('smoothed constant value from 0 with alpha = 0.5', () => {
    const v = new ExponentialSmoothValue(0.5, 0)

    expect(v.add(2).value).toMatchInlineSnapshot(`1`)
    expect(v.add(2).value).toMatchInlineSnapshot(`1.5`)
    expect(v.add(2).value).toMatchInlineSnapshot(`1.75`)
    expect(v.add(2).value).toMatchInlineSnapshot(`1.875`)
    expect(v.add(2).value).toMatchInlineSnapshot(`1.9375`)
    expect(v.add(2).value).toMatchInlineSnapshot(`1.96875`)
    expect(v.add(2).value).toMatchInlineSnapshot(`1.984375`)
    expect(v.add(2).value).toMatchInlineSnapshot(`1.9921875`)
    expect(v.add(2).value).toMatchInlineSnapshot(`1.99609375`)
    expect(v.add(2).value).toMatchInlineSnapshot(`1.998046875`)
    expect(v.add(2).value).toMatchInlineSnapshot(`1.9990234375`)
    expect(v.add(2).value).toMatchInlineSnapshot(`1.99951171875`)
    expect(v.add(2).value).toMatchInlineSnapshot(`1.999755859375`)
  })

  test('smoothed increasing value from 0 with alpha = 0.5', () => {
    const v = new ExponentialSmoothValue(0.5, 0)

    expect(v.add(1).value).toMatchInlineSnapshot(`0.5`)
    expect(v.add(2).value).toMatchInlineSnapshot(`1.25`)
    expect(v.add(4).value).toMatchInlineSnapshot(`2.625`)
    expect(v.add(8).value).toMatchInlineSnapshot(`5.3125`)
    expect(v.add(16).value).toMatchInlineSnapshot(`10.65625`)
    expect(v.add(32).value).toMatchInlineSnapshot(`21.328125`)
    expect(v.add(64).value).toMatchInlineSnapshot(`42.6640625`)
    expect(v.add(128).value).toMatchInlineSnapshot(`85.33203125`)
    expect(v.add(256).value).toMatchInlineSnapshot(`170.666015625`)
    expect(v.add(512).value).toMatchInlineSnapshot(`341.3330078125`)
    expect(v.add(1024).value).toMatchInlineSnapshot(`682.66650390625`)
    expect(v.add(2048).value).toMatchInlineSnapshot(`1365.333251953125`)
    expect(v.add(4096).value).toMatchInlineSnapshot(`2730.6666259765625`)
  })

  test('smoothed decreasing value from 0 with alpha = 0.5', () => {
    const v = new ExponentialSmoothValue(0.5, 0)

    expect(v.add(4096).value).toMatchInlineSnapshot(`2048`)
    expect(v.add(2048).value).toMatchInlineSnapshot(`2048`)
    expect(v.add(1024).value).toMatchInlineSnapshot(`1536`)
    expect(v.add(512).value).toMatchInlineSnapshot(`1024`)
    expect(v.add(256).value).toMatchInlineSnapshot(`640`)
    expect(v.add(128).value).toMatchInlineSnapshot(`384`)
    expect(v.add(64).value).toMatchInlineSnapshot(`224`)
    expect(v.add(32).value).toMatchInlineSnapshot(`128`)
    expect(v.add(16).value).toMatchInlineSnapshot(`72`)
    expect(v.add(8).value).toMatchInlineSnapshot(`40`)
    expect(v.add(4).value).toMatchInlineSnapshot(`22`)
    expect(v.add(2).value).toMatchInlineSnapshot(`12`)
    expect(v.add(1).value).toMatchInlineSnapshot(`6.5`)
  })

  test('smoothed oscillating value from 0 with alpha = 0.5', () => {
    const v = new ExponentialSmoothValue(0.5, 0)

    expect(v.add(4096).value).toMatchInlineSnapshot(`2048`)
    expect(v.add(0).value).toMatchInlineSnapshot(`1024`)
    expect(v.add(4096).value).toMatchInlineSnapshot(`2560`)
    expect(v.add(0).value).toMatchInlineSnapshot(`1280`)
    expect(v.add(4096).value).toMatchInlineSnapshot(`2688`)
    expect(v.add(0).value).toMatchInlineSnapshot(`1344`)
    expect(v.add(4096).value).toMatchInlineSnapshot(`2720`)
    expect(v.add(0).value).toMatchInlineSnapshot(`1360`)
    expect(v.add(4096).value).toMatchInlineSnapshot(`2728`)
    expect(v.add(0).value).toMatchInlineSnapshot(`1364`)
    expect(v.add(4096).value).toMatchInlineSnapshot(`2730`)
    expect(v.add(0).value).toMatchInlineSnapshot(`1365`)
    expect(v.add(4096).value).toMatchInlineSnapshot(`2730.5`)
  })

  test('smoothed oscillating value from 0 with alpha = 0.75', () => {
    const v = new ExponentialSmoothValue(0.75, 0)

    expect(v.add(4096).value).toMatchInlineSnapshot(`3072`)
    expect(v.add(0).value).toMatchInlineSnapshot(`768`)
    expect(v.add(4096).value).toMatchInlineSnapshot(`3264`)
    expect(v.add(0).value).toMatchInlineSnapshot(`816`)
    expect(v.add(4096).value).toMatchInlineSnapshot(`3276`)
    expect(v.add(0).value).toMatchInlineSnapshot(`819`)
    expect(v.add(4096).value).toMatchInlineSnapshot(`3276.75`)
    expect(v.add(0).value).toMatchInlineSnapshot(`819.1875`)
    expect(v.add(4096).value).toMatchInlineSnapshot(`3276.796875`)
    expect(v.add(0).value).toMatchInlineSnapshot(`819.19921875`)
    expect(v.add(4096).value).toMatchInlineSnapshot(`3276.7998046875`)
    expect(v.add(0).value).toMatchInlineSnapshot(`819.199951171875`)
    expect(v.add(4096).value).toMatchInlineSnapshot(`3276.7999877929688`)
  })

  test('smoothed oscillating value from 0 with alpha = 0.25', () => {
    const v = new ExponentialSmoothValue(0.25, 0)

    expect(v.add(4096).value).toMatchInlineSnapshot(`1024`)
    expect(v.add(0).value).toMatchInlineSnapshot(`768`)
    expect(v.add(4096).value).toMatchInlineSnapshot(`1600`)
    expect(v.add(0).value).toMatchInlineSnapshot(`1200`)
    expect(v.add(4096).value).toMatchInlineSnapshot(`1924`)
    expect(v.add(0).value).toMatchInlineSnapshot(`1443`)
    expect(v.add(4096).value).toMatchInlineSnapshot(`2106.25`)
    expect(v.add(0).value).toMatchInlineSnapshot(`1579.6875`)
    expect(v.add(4096).value).toMatchInlineSnapshot(`2208.765625`)
    expect(v.add(0).value).toMatchInlineSnapshot(`1656.57421875`)
    expect(v.add(4096).value).toMatchInlineSnapshot(`2266.4306640625`)
    expect(v.add(0).value).toMatchInlineSnapshot(`1699.822998046875`)
    expect(v.add(4096).value).toMatchInlineSnapshot(`2298.8672485351562`)
  })

  test('reset(value) sets the value directly', () => {
    const v = new ExponentialSmoothValue(0.25, 0)

    v.add(4096).add(4096).add(4096)
    expect(v.reset(7).value).toEqual(7)
  })
})
