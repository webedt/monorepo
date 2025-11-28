import { truncateSessionName } from './utils';

describe('truncateSessionName', () => {
  it('should not truncate short session names', () => {
    const shortName = 'Fix authentication bug';
    expect(truncateSessionName(shortName)).toBe(shortName);
  });

  it('should not truncate session names at the exact max length', () => {
    const exactLengthName = 'a'.repeat(80);
    expect(truncateSessionName(exactLengthName)).toBe(exactLengthName);
  });

  it('should truncate session names exceeding max length with ellipsis', () => {
    const longName = 'This is a very long session name that exceeds the maximum allowed length and should be truncated with ellipsis';
    const result = truncateSessionName(longName, 80);

    expect(result.length).toBe(80);
    expect(result.endsWith('...')).toBe(true);
    expect(result).toBe(longName.substring(0, 77) + '...');
  });

  it('should handle custom max length', () => {
    const name = 'This is a moderately long session name';
    const result = truncateSessionName(name, 20);

    expect(result.length).toBe(20);
    expect(result.endsWith('...')).toBe(true);
    expect(result).toBe('This is a moderat...');
  });

  it('should handle empty strings', () => {
    expect(truncateSessionName('')).toBe('');
  });

  it('should handle single character names', () => {
    expect(truncateSessionName('A')).toBe('A');
  });

  it('should handle excessively long session names (e.g., full user request)', () => {
    const veryLongName = 'Please help me implement a comprehensive authentication system with OAuth2, JWT tokens, refresh tokens, role-based access control, and multi-factor authentication for my web application';
    const result = truncateSessionName(veryLongName, 80);

    expect(result.length).toBe(80);
    expect(result.endsWith('...')).toBe(true);
    expect(result).toBe('Please help me implement a comprehensive authentication system with OAuth2, ...');
  });
});
