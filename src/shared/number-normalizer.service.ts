export class NumberNormalizerService {
  /**
   * @section factory
   */

  public static create(): NumberNormalizerService {
    const service = new NumberNormalizerService();
    return service;
  }

  /**
   * @section public:methods
   */

  public clamp(value: number, minimum: number, maximum: number): number {
    const clampedValue = Math.min(Math.max(value, minimum), maximum);
    return clampedValue;
  }

  public round(value: number, decimals = 0): number {
    const factor = 10 ** decimals;
    const roundedValue = Math.round(value * factor) / factor;
    return roundedValue;
  }
}
