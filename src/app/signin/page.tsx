'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { getModuleByPathname } from '@/modules/registry';
import { useDefaultModuleId } from '@/shared/components/default-module-provider';

const PHONE_RE = /^1[3-9]\d{9}$/;

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const raw = searchParams.get('callbackUrl') ?? '/';
  const callbackUrl = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';

  const defaultModuleId = useDefaultModuleId();
  const mod = getModuleByPathname(callbackUrl, defaultModuleId);

  const OTP_LENGTH = 6;
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const boxRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // 切到验证码步骤时自动聚焦第一个格子
  useEffect(() => {
    if (step === 'code') boxRefs.current[0]?.focus();
  }, [step]);

  const code = digits.join('');

  const updateDigits = useCallback((next: string[]) => {
    setDigits(next);
    if (next.every((d) => d !== '') && next.length === OTP_LENGTH) {
      // 6 位填满，自动触发验证（通过隐藏 submit）
      setTimeout(() => {
        document
          .getElementById('otp-form')
          ?.dispatchEvent(
            new Event('submit', { cancelable: true, bubbles: true }),
          );
      }, 0);
    }
  }, []);

  const handleBoxChange = (index: number, value: string) => {
    // 处理粘贴或多字符输入
    const cleaned = value.replace(/\D/g, '');
    if (cleaned.length > 1) {
      // 粘贴场景：从当前格子开始填入
      const next = [...digits];
      for (let i = 0; i < cleaned.length && index + i < OTP_LENGTH; i++) {
        next[index + i] = cleaned[i] ?? '';
      }
      updateDigits(next);
      const focusIdx = Math.min(index + cleaned.length, OTP_LENGTH - 1);
      boxRefs.current[focusIdx]?.focus();
      return;
    }
    const next = [...digits];
    next[index] = cleaned;
    updateDigits(next);
    if (cleaned && index < OTP_LENGTH - 1) {
      boxRefs.current[index + 1]?.focus();
    }
  };

  const handleBoxKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      const next = [...digits];
      next[index - 1] = '';
      updateDigits(next);
      boxRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '');
    if (!pasted) return;
    const next = [...digits];
    for (let i = 0; i < pasted.length && i < OTP_LENGTH; i++) {
      next[i] = pasted[i] ?? '';
    }
    updateDigits(next);
    const focusIdx = Math.min(pasted.length, OTP_LENGTH - 1);
    boxRefs.current[focusIdx]?.focus();
  };

  const startCountdown = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setCountdown(60);
    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!PHONE_RE.test(phone)) {
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
    } catch {
      setError('发送失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
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
      setError('验证失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm transition-colors focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20';

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-orange-50 to-pink-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link className={`font-bold text-3xl ${mod.theme.brand}`} href="/">
            {mod.name}
          </Link>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-lg">
          <h1 className="mb-2 text-center font-semibold text-2xl text-gray-900">
            登录
          </h1>
          <p className="mb-6 text-center text-gray-500 text-sm">
            {step === 'phone'
              ? '请输入手机号获取验证码'
              : `验证码已发送至 ${phone}`}
          </p>

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
                  className={inputClass}
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
            <form className="space-y-4" id="otp-form" onSubmit={handleVerify}>
              <div>
                <label
                  className="mb-2 block font-medium text-gray-700 text-sm"
                  htmlFor="otp-hidden"
                >
                  验证码
                </label>
                {/* 隐藏 input 支持浏览器 OTP 自动填充 */}
                <input
                  autoComplete="one-time-code"
                  className="sr-only"
                  id="otp-hidden"
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '');
                    if (!v) return;
                    const next = Array(OTP_LENGTH).fill('') as string[];
                    for (let i = 0; i < v.length && i < OTP_LENGTH; i++)
                      next[i] = v[i] ?? '';
                    updateDigits(next);
                    boxRefs.current[
                      Math.min(v.length, OTP_LENGTH - 1)
                    ]?.focus();
                  }}
                  tabIndex={-1}
                  type="text"
                />
                <div
                  className="flex justify-between gap-2"
                  onPaste={handlePaste}
                >
                  {digits.map((digit, i) => (
                    <input
                      aria-label={`验证码第 ${i + 1} 位`}
                      className="h-12 w-12 flex-1 rounded-lg border border-gray-300 text-center font-semibold text-lg transition-colors focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                      inputMode="numeric"
                      key={i}
                      maxLength={1}
                      onChange={(e) => handleBoxChange(i, e.target.value)}
                      onKeyDown={(e) => handleBoxKeyDown(i, e)}
                      ref={(el) => {
                        boxRefs.current[i] = el;
                      }}
                      type="text"
                      value={digit}
                    />
                  ))}
                </div>
              </div>
              <button
                className={`w-full rounded-lg px-4 py-2.5 font-medium text-white transition-all disabled:cursor-not-allowed disabled:opacity-50 ${mod.theme.btn}`}
                disabled={loading}
                type="submit"
              >
                {loading ? '验证中...' : '登录'}
              </button>
              <button
                className="w-full text-center text-gray-400 text-sm disabled:opacity-40"
                disabled={countdown > 0}
                onClick={() => {
                  setStep('phone');
                  setDigits(Array(OTP_LENGTH).fill(''));
                  setError('');
                }}
                type="button"
              >
                {countdown > 0
                  ? `重新发送 (${countdown}s)`
                  : '修改手机号并重新获取'}
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
