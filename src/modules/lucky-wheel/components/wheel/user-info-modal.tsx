'use client';

import { useEffect, useRef, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { isOtpInvalidated, resolveAuthError } from '@/lib/auth-error';
import { authMethod } from '@/lib/auth-methods';
import { EMAIL_RE, PHONE_RE } from '@/modules/lucky-wheel/constants';

/**
 * 当前使用的 OTP 方式：email-otp 或 phone-otp，email-password 不适用于此场景。
 * dingtalk 模式复用 phone-otp 表单：钉钉外打开或免登失败时回退到手机验证码登录。
 */
const otpMode =
  authMethod === 'email-otp'
    ? 'email-otp'
    : authMethod === 'phone-otp' || authMethod === 'dingtalk'
      ? 'phone-otp'
      : null;

/** 姓名默认值是否可用：`${phone}@phone.local` / 纯手机号这类系统生成值不预填 */
function isUsableDefaultName(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (PHONE_RE.test(trimmed)) return false;
  if (trimmed.includes('@phone.local')) return false;
  return true;
}

interface UserInfoModalProps {
  open: boolean;
  onSuccess: (info: { name: string; address: string }) => void;
  /** 已登录时只收集收货地址，跳过 OTP 步骤 */
  loggedIn?: boolean;
  /** 姓名预填值（如钉钉免登拿到的用户姓名） */
  defaultName?: string;
  /** 回退提示（如「钉钉免登失败，请使用手机验证码登录」），非空时显示在副标题下方 */
  fallbackHint?: string;
}

export function UserInfoModal({
  open,
  onSuccess,
  loggedIn = false,
  defaultName,
  fallbackHint,
}: UserInfoModalProps) {
  const [step, setStep] = useState<'info' | 'code'>('info');
  const [name, setName] = useState(() =>
    isUsableDefaultName(defaultName) ? defaultName.trim() : '',
  );
  const [identifier, setIdentifier] = useState(''); // 邮箱或手机号
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 防止验证/发送请求并发重复提交（重复提交会让正确验证码被二次消费而误报错误）
  const submittingRef = useRef(false);

  // modal 关闭时停止倒计时；组件卸载时清理 timer
  useEffect(() => {
    if (!open) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setCountdown(0);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [open]);

  // defaultName 异步到达（如 session 加载完成）时补填，已手动输入过则不覆盖
  useEffect(() => {
    if (!isUsableDefaultName(defaultName)) return;
    setName((prev) => (prev.trim() ? prev : defaultName.trim()));
  }, [defaultName]);

  // 弹窗打开时禁止页面滚动
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [open]);

  if (!open) return null;

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

  // 已登录 或 无 OTP 方式：收集姓名和收货地址
  const handleSaveAddress = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('请填写姓名');
      return;
    }
    if (!address.trim()) {
      setError('请填写收货地址');
      return;
    }
    onSuccess({ name: name.trim(), address: address.trim() });
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('请填写姓名');
      return;
    }
    if (otpMode === 'email-otp' && !EMAIL_RE.test(identifier)) {
      setError('请输入有效的邮箱地址');
      return;
    }
    if (otpMode === 'phone-otp' && !PHONE_RE.test(identifier)) {
      setError('请输入有效的手机号');
      return;
    }
    if (!address.trim()) {
      setError('请填写收货地址');
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError('');
    setLoading(true);
    try {
      if (otpMode === 'email-otp') {
        const result = await authClient.emailOtp.sendVerificationOtp({
          email: identifier,
          type: 'sign-in',
        });
        if (result.error) {
          setError(resolveAuthError(result.error, '发送失败，请稍后重试'));
          return;
        }
      } else if (otpMode === 'phone-otp') {
        const result = await authClient.phoneNumber.sendOtp({
          phoneNumber: identifier,
        });
        if (result.error) {
          setError(resolveAuthError(result.error, '发送失败，请稍后重试'));
          return;
        }
      }
      setStep('code');
      startCountdown();
    } catch {
      setError('发送失败，请稍后重试');
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) {
      setError('请输入6位验证码');
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError('');
    setLoading(true);
    try {
      if (otpMode === 'email-otp') {
        const result = await authClient.signIn.emailOtp({
          email: identifier,
          otp: code,
        });
        if (result.error) {
          setError(resolveAuthError(result.error, '验证码错误，请重试'));
          // 验证码已被服务端作废（错误次数过多/过期/失效）：清空旧码并放开「重新获取」，
          // 否则用户会卡在已失效的旧码上一直提示「不正确」。
          if (isOtpInvalidated(result.error)) {
            setCode('');
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
            setCountdown(0);
          }
          return;
        }
      } else if (otpMode === 'phone-otp') {
        const result = await authClient.phoneNumber.verify({
          phoneNumber: identifier,
          code,
        });
        if (result.error) {
          setError(resolveAuthError(result.error, '验证码错误，请重试'));
          // 验证码已被服务端作废（错误次数过多/过期/失效）：清空旧码并放开「重新获取」，
          // 否则用户会卡在已失效的旧码上一直提示「不正确」。
          if (isOtpInvalidated(result.error)) {
            setCode('');
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
            setCountdown(0);
          }
          return;
        }
      }
      onSuccess({ name: name.trim(), address: address.trim() });
    } catch {
      setError('验证失败，请重试');
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  const btnStyle = {
    background: 'linear-gradient(114deg, #FF8D67 0%, #F0361D 100%)',
  };

  // OTP 未启用 或 已登录：仅收集信息
  const showSimpleForm = loggedIn || !otpMode;

  const identifierLabel = otpMode === 'email-otp' ? '邮箱地址' : '手机号';
  const identifierInputProps =
    otpMode === 'email-otp'
      ? {
          type: 'email' as const,
          autoComplete: 'email',
          placeholder: '邮箱地址',
          inputMode: undefined as undefined,
          maxLength: undefined as undefined,
        }
      : {
          type: 'tel' as const,
          autoComplete: 'tel',
          placeholder: '手机号',
          inputMode: 'numeric' as const,
          maxLength: 11,
        };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="lw-modal-slide-up w-full max-w-sm overflow-hidden rounded-3xl"
        style={{
          background:
            'linear-gradient(180deg, #FFD6D6 0%, #FFF1F3 13%, #FFF 100%)',
        }}
      >
        <div className="p-8">
          <h2 className="mb-1 text-center font-bold text-gray-900 text-xl">
            参与抽奖
          </h2>
          <p className="mb-6 text-center text-gray-500 text-sm">
            {showSimpleForm
              ? '请填写收货地址以便寄送奖品'
              : step === 'info'
                ? '请填写以下信息后获取验证码'
                : `验证码已发送至 ${identifier}`}
          </p>

          {fallbackHint && (
            <p className="-mt-4 mb-4 text-center text-gray-400 text-xs">
              {fallbackHint}
            </p>
          )}

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-center text-red-600 text-sm">
              {error}
            </div>
          )}

          {showSimpleForm ? (
            <form className="space-y-3" onSubmit={handleSaveAddress}>
              <input
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-400/20"
                onChange={(e) => setName(e.target.value)}
                placeholder="姓名"
                required
                type="text"
                value={name}
              />
              <textarea
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-400/20"
                onChange={(e) => setAddress(e.target.value)}
                placeholder="收货地址（省市区街道门牌号）"
                required
                rows={3}
                value={address}
              />
              <button
                className="w-full rounded-full py-3 font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-50"
                style={btnStyle}
                type="submit"
              >
                确认参与
              </button>
            </form>
          ) : step === 'info' ? (
            <form className="space-y-3" onSubmit={handleSendOtp}>
              <input
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-400/20"
                onChange={(e) => setName(e.target.value)}
                placeholder="姓名"
                required
                type="text"
                value={name}
              />
              <input
                autoComplete={identifierInputProps.autoComplete}
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-400/20"
                inputMode={identifierInputProps.inputMode}
                maxLength={identifierInputProps.maxLength}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={identifierInputProps.placeholder}
                required
                type={identifierInputProps.type}
                value={identifier}
              />
              <textarea
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-400/20"
                onChange={(e) => setAddress(e.target.value)}
                placeholder="收货地址（省市区街道门牌号）"
                required
                rows={2}
                value={address}
              />
              <button
                className="w-full rounded-full py-3 font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-50"
                disabled={loading}
                style={btnStyle}
                type="submit"
              >
                {loading ? '发送中...' : '获取验证码'}
              </button>
            </form>
          ) : (
            <form className="space-y-4" onSubmit={handleVerifyOtp}>
              <input
                autoComplete="one-time-code"
                className="w-full rounded-xl border border-gray-200 px-4 py-4 text-center text-2xl tracking-widest focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-400/20"
                inputMode="numeric"
                maxLength={6}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="_ _ _ _ _ _"
                required
                type="text"
                value={code}
              />
              <button
                className="w-full rounded-full py-3 font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-50"
                disabled={loading}
                style={btnStyle}
                type="submit"
              >
                {loading ? '验证中...' : '确认登录'}
              </button>
              <button
                className="w-full text-center text-gray-400 text-sm disabled:opacity-40"
                disabled={countdown > 0}
                onClick={() => {
                  setStep('info');
                  setCode('');
                  setError('');
                }}
                type="button"
              >
                {countdown > 0
                  ? `重新发送 (${countdown}s)`
                  : `修改${identifierLabel}并重新获取`}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
