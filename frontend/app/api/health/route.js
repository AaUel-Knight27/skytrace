import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    engine: 'SkyTrace Next.js API + Python microservice bridge',
    utc_iso: new Date().toISOString(),
    frontend: 'Next.js 15 App Router',
    services: {
      ephemeris: 'JPL Horizons Vector API',
      archive: 'Caltech/IPAC IRSA SPHEREx Level-2 MEF & ALLWISE TAP'
    }
  }, {
    headers: {
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export async function HEAD() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
