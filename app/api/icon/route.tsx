import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const size = parseInt(searchParams.get('size') ?? '192', 10);
  const pad = Math.round(size * 0.13);
  const gap = Math.round(size * 0.08);
  const dotSize = Math.round(size * 0.1);
  const lineH = Math.max(2, Math.round(size * 0.022));
  const innerW = size - pad * 2;

  return new ImageResponse(
    (
      <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'white', borderRadius: Math.round(size * 0.22) }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap, width: innerW }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: Math.round(size * 0.05) }}>
              <div style={{ width: dotSize, height: dotSize, borderRadius: dotSize / 2, backgroundColor: '#374151', flexShrink: 0 }} />
              <div style={{ flex: 1, height: lineH, borderRadius: lineH / 2, backgroundColor: '#9ca3af' }} />
            </div>
          ))}
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
