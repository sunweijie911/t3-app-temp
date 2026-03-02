'use client';

import { useEffect, useRef, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { PHONE_RE } from '@/modules/lucky-wheel/constants';

interface UserInfoModalProps {
  open: boolean;
  onSuccess: (info: { name: string; address: string }) => void;
  /** 已登录时只收集收货地址，跳过手机号 OTP 步骤 */
  loggedIn?: boolean;
}

export function UserInfoModal({
  open,
  onSuccess,
  loggedIn = false,
}: UserInfoModalProps) {
  const [step, setStep] = useState<'info' | 'code'>('info');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // modal 关闭时停止倒计时；组件卸载时清理 timer（防内存泄漏）
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

  if (!open) return null;

  const startCountdown = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
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

  // 已登录：收集姓名和收货地址，保存后关闭
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
    if (!PHONE_RE.test(phone)) {
      setError('请输入有效的手机号');
      return;
    }
    if (!address.trim()) {
      setError('请填写收货地址');
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
      onSuccess({ name, address });
    } catch {
      setError('验证失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const btnStyle = {
    background: 'linear-gradient(114deg, #FF8D67 0%, #F0361D 100%)',
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
            {loggedIn
              ? '请填写收货地址以便寄送奖品'
              : step === 'info'
                ? '请填写以下信息后获取验证码'
                : `验证码已发送至 ${phone}`}
          </p>

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-center text-red-600 text-sm">
              {error}
            </div>
          )}

          {/* 已登录：填姓名 + 地址 */}
          {loggedIn ? (
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
            /* 未登录：填写信息 + 发送 OTP */
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
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-400/20"
                inputMode="numeric"
                maxLength={11}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="手机号"
                required
                type="tel"
                value={phone}
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
            /* 未登录：OTP 验证 */
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
                  : '修改信息并重新获取'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
