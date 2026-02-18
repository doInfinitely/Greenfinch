import { NextResponse } from 'next/server';

interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

interface ApiErrorResponse {
  success: false;
  error: string;
  meta?: Record<string, unknown>;
}

export function apiSuccess<T = unknown>(
  data: T,
  options?: { status?: number; meta?: Record<string, unknown>; headers?: Record<string, string> }
): NextResponse<ApiSuccessResponse<T>> {
  const body: ApiSuccessResponse<T> = { success: true, data };
  if (options?.meta) {
    body.meta = options.meta;
  }
  return NextResponse.json(body, {
    status: options?.status ?? 200,
    headers: options?.headers,
  });
}

export function apiError(
  error: string,
  options?: { status?: number; meta?: Record<string, unknown>; headers?: Record<string, string> }
): NextResponse<ApiErrorResponse> {
  const body: ApiErrorResponse = { success: false, error };
  if (options?.meta) {
    body.meta = options.meta;
  }
  return NextResponse.json(body, {
    status: options?.status ?? 500,
    headers: options?.headers,
  });
}

export function apiNotFound(message: string = 'Not found'): NextResponse<ApiErrorResponse> {
  return apiError(message, { status: 404 });
}

export function apiBadRequest(message: string = 'Bad request'): NextResponse<ApiErrorResponse> {
  return apiError(message, { status: 400 });
}

export function apiUnauthorized(message: string = 'Unauthorized'): NextResponse<ApiErrorResponse> {
  return apiError(message, { status: 401 });
}
