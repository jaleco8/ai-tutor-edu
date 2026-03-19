import { deriveSkillStatus, normalizeAccuracy, selectOfflineHint } from './learning.utils';

describe('learning utils', () => {
  it('normalizes accuracy with two decimals', () => {
    expect(normalizeAccuracy(3, 4)).toBe(75);
    expect(normalizeAccuracy(0, 0)).toBe(0);
  });

  it('derives the expected mastery status', () => {
    expect(deriveSkillStatus(0, 0)).toBe('sin_datos');
    expect(deriveSkillStatus(55, 5)).toBe('en_proceso');
    expect(deriveSkillStatus(90, 10)).toBe('dominado');
  });

  it('selects the best offline hint based on keywords', () => {
    const hint = selectOfflineHint([
      { hint_type: 'concepto_clave', content: 'Piensa en la regla principal.' },
      { hint_type: 'pregunta_socratica', content: '¿Que paso harías primero?' },
    ], 'No entiendo el paso del razonamiento');

    expect(hint).toBe('¿Que paso harías primero?');
  });
});
