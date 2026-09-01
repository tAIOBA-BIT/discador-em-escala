import { NextResponse } from 'next/server';

const AUTH_COOKIE = 'discador_auth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { password } = body;
    
    const validPassword = process.env.AUTH_SECRET;
    
    if (!validPassword) {
      return NextResponse.json(
        { error: 'Auth not configured' },
        { status: 500 }
      );
    }
    
    if (password !== validPassword) {
      return NextResponse.json(
        { error: 'Invalid password' },
        { status: 401 }
      );
    }
    
    const response = NextResponse.json({ success: true });
    
    // Set auth cookie (expires in 7 days)
    response.cookies.set(AUTH_COOKIE, validPassword, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/',
    });
    
    return response;
  } catch {
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400 }
    );
  }
}
