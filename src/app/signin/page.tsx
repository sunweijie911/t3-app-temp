'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useRef, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { getModuleByPathname } from '@/modules/registry';
import { useDefaultModuleId } from '@/shared/components/default-module-provider';

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const raw = searchParams.get('callbackUrl') ?? '/';
  const callbackUrl = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';

  const defaultModuleId = useDefaultModuleId();
  const mod = getModuleByPathname(callbackUrl, defaultModuleId);

  const [phone, setPhone] = useState('');
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const code = digits.join('');

  const startCountdown = () => {
    setCountdown(60);
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  const handleDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleDigitPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData
      .getData('text')
      .replace(/\D/g, '')
      .slice(0, 6);
    if (!pasted) return;
    const next = digits.map((_, i) => pasted[i] ?? '');
    setDigits(next);
    inputRefs.current[Math.min(pasted.length, 5)]?.focus();
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError('请输入有效的手机号');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const result = await authClient.phoneNumber.sendOtp({
        phoneNumber: phone,
      });
      if (result.error) {
        setError(result.error.message ?? '发送失败，请稍后重试');
        return;
      }
      setStep('code');
      startCountdown();
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } catch {
      setError('发送失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setError('');
    try {
      await authClient.phoneNumber.sendOtp({ phoneNumber: phone });
      setDigits(['', '', '', '', '', '']);
      startCountdown();
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } catch {
      setError('发送失败，请稍后重试');
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) {
      setError('请输入6位验证码');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const result = await authClient.phoneNumber.verify({
        phoneNumber: phone,
        code,
      });
      if (result.error) {
        setError(result.error.message ?? '验证码错误，请重试');
        return;
      }
      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError('验证失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (step === 'code') {
      setStep('phone');
      setDigits(['', '', '', '', '', '']);
      setError('');
    } else {
      router.back();
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-orange-50 to-pink-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link className={`font-bold text-3xl ${mod.theme.brand}`} href="/">
            {mod.name}
          </Link>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-lg">
          <div className="relative mb-6 flex items-center justify-center">
            <button
              aria-label="返回"
              className="absolute left-0 flex items-center text-gray-400 transition-colors hover:text-gray-600"
              onClick={handleBack}
              type="button"
            >
              <svg
                aria-hidden="true"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  d="M15 19l-7-7 7-7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <h1 className="font-semibold text-2xl text-gray-900">
              {step === 'phone' ? '输入手机号' : '输入验证码'}
            </h1>
          </div>

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-center text-red-600 text-sm">
              {error}
            </div>
          )}

          {step === 'phone' ? (
            <form className="space-y-4" onSubmit={handleSendOtp}>
              <div>
                <label
                  className="mb-1 block font-medium text-gray-700 text-sm"
                  htmlFor="phone"
                >
                  手机号
                </label>
                <input
                  autoComplete="tel"
                  className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm transition-colors focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                  id="phone"
                  inputMode="numeric"
                  maxLength={11}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="请输入手机号"
                  required
                  type="tel"
                  value={phone}
                />
              </div>
              <button
                className={`w-full rounded-lg px-4 py-2.5 font-medium text-white transition-all disabled:cursor-not-allowed disabled:opacity-50 ${mod.theme.btn}`}
                disabled={loading}
                type="submit"
              >
                {loading ? '发送中...' : '获取验证码'}
              </button>
            </form>
          ) : (
            <form className="space-y-6" onSubmit={handleVerifyOtp}>
              <div>
                <p className="mb-4 text-center text-gray-500 text-sm">
                  已发送至 {phone}
                </p>
                <div className="flex justify-between gap-2">
                  {digits.map((digit, i) => (
                    <input
                      autoComplete={i === 0 ? 'one-time-code' : 'off'}
                      className={`h-13 w-full rounded-xl border-2 text-center font-semibold text-gray-900 text-xl transition-all focus:outline-none focus:ring-2 focus:ring-orange-500/20 ${
                        digit
                          ? 'border-orange-400 bg-orange-50'
                          : 'border-gray-200 bg-white focus:border-orange-500'
                      }`}
                      inputMode="numeric"
                      key={i}
                      maxLength={1}
                      onChange={(e) => handleDigitChange(i, e.target.value)}
                      onKeyDown={(e) => handleDigitKeyDown(i, e)}
                      onPaste={handleDigitPaste}
                      ref={(el) => {
                        inputRefs.current[i] = el;
                      }}
                      type="text"
                      value={digit}
                    />
                  ))}
                </div>
              </div>
              <button
                className={`w-full rounded-lg px-4 py-2.5 font-medium text-white transition-all disabled:cursor-not-allowed disabled:opacity-50 ${mod.theme.btn}`}
                disabled={loading || code.length !== 6}
                type="submit"
              >
                {loading ? '验证中...' : '确认登录'}
              </button>
              <button
                className="w-full text-center text-gray-500 text-sm disabled:opacity-50"
                disabled={countdown > 0}
                onClick={handleResendOtp}
                type="button"
              >
                {countdown > 0 ? `重新发送 (${countdown}s)` : '重新获取验证码'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
