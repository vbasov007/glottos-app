import { describe, it, expect } from 'vitest';
import { chunksToWav, decodeJwt, LEAD_SILENCE, stripParentheticals } from '../../src/utils';

describe('stripParentheticals', () => {
  it('removes a parenthetical aside and tidies spacing', () => {
    expect(stripParentheticals('Er ging (schnell) nach Hause.')).toBe('Er ging nach Hause.');
  });

  it('removes a trailing parenthetical before punctuation', () => {
    expect(stripParentheticals('Das ist gut (oder?).')).toBe('Das ist gut.');
  });

  it('handles a parenthetical containing a period', () => {
    expect(stripParentheticals('Komm (z.B. heute) vorbei.')).toBe('Komm vorbei.');
  });

  it('leaves text without parentheses unchanged', () => {
    expect(stripParentheticals('Ganz normaler Satz.')).toBe('Ganz normaler Satz.');
  });

  it('returns empty for a wholly parenthetical string', () => {
    expect(stripParentheticals('(nur eine Notiz)')).toBe('');
  });
});

describe('chunksToWav', () => {
  it('should produce a valid WAV blob with correct header', async () => {
    const samples = new Int16Array([0, 1000, -1000, 32767, -32768]);
    const blob = chunksToWav([samples], 24000);

    expect(blob.type).toBe('audio/wav');

    const arrayBuffer = await blob.arrayBuffer();
    const dv = new DataView(arrayBuffer);

    // RIFF header
    expect(String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3))).toBe('RIFF');
    // WAVE
    expect(String.fromCharCode(dv.getUint8(8), dv.getUint8(9), dv.getUint8(10), dv.getUint8(11))).toBe('WAVE');
    // fmt
    expect(String.fromCharCode(dv.getUint8(12), dv.getUint8(13), dv.getUint8(14), dv.getUint8(15))).toBe('fmt ');
    // PCM format (1)
    expect(dv.getUint16(20, true)).toBe(1);
    // Mono
    expect(dv.getUint16(22, true)).toBe(1);
    // Sample rate
    expect(dv.getUint32(24, true)).toBe(24000);
    // Bits per sample
    expect(dv.getUint16(34, true)).toBe(16);
    // Data size = 5 samples * 2 bytes
    expect(dv.getUint32(40, true)).toBe(10);
    // Total file size
    expect(arrayBuffer.byteLength).toBe(44 + 10);
  });

  it('should concatenate multiple chunks', async () => {
    const chunk1 = new Int16Array([100, 200]);
    const chunk2 = new Int16Array([300, 400, 500]);
    const blob = chunksToWav([chunk1, chunk2], 16000);

    const arrayBuffer = await blob.arrayBuffer();
    const dv = new DataView(arrayBuffer);

    // Data size = 5 samples * 2 bytes
    expect(dv.getUint32(40, true)).toBe(10);
    // Verify sample values
    expect(dv.getInt16(44, true)).toBe(100);
    expect(dv.getInt16(46, true)).toBe(200);
    expect(dv.getInt16(48, true)).toBe(300);
    expect(dv.getInt16(50, true)).toBe(400);
    expect(dv.getInt16(52, true)).toBe(500);
  });

  it('should handle empty chunks', async () => {
    const blob = chunksToWav([], 24000);
    const arrayBuffer = await blob.arrayBuffer();
    expect(arrayBuffer.byteLength).toBe(44); // header only
  });
});

describe('decodeJwt', () => {
  it('should decode a valid JWT payload', () => {
    // Build a minimal JWT: header.payload.signature
    const payload = { sub: '12345', name: 'Test User', email: 'test@example.com' };
    const encoded = btoa(JSON.stringify(payload));
    const token = `eyJhbGciOiJSUzI1NiJ9.${encoded}.fakesig`;

    const result = decodeJwt(token);
    expect(result.sub).toBe('12345');
    expect(result.name).toBe('Test User');
    expect(result.email).toBe('test@example.com');
  });

  it('should handle URL-safe base64 characters', () => {
    const payload = { data: 'test+value/special=' };
    const encoded = btoa(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const token = `header.${encoded}.sig`;

    const result = decodeJwt(token);
    expect(result.data).toBe('test+value/special=');
  });
});

describe('LEAD_SILENCE', () => {
  it('should be 7200 samples (300ms at 24kHz)', () => {
    expect(LEAD_SILENCE).toBe(7200);
    expect(LEAD_SILENCE / 24000).toBeCloseTo(0.3);
  });
});
