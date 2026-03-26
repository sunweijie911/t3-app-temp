'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useVConsole } from '@/modules/info-collect/components/use-vconsole';
import { ID_CARD_RE, MODULE_NAME } from '@/modules/info-collect/constants';
import { api } from '@/trpc/react';

interface DingtalkUserInfo {
  name: string;
  userid: string;
  mobile: string;
  position: string;
  department: string;
  jobNumber: string;
}

type Step = 'loading' | 'form' | 'submitted' | 'error';

export default function InfoCollectPage() {
  useVConsole();
  const [step, setStep] = useState<Step>('loading');
  const [userInfo, setUserInfo] = useState<DingtalkUserInfo | null>(null);
  const [idCard, setIdCard] = useState('');
  const [idCardError, setIdCardError] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const { data: config } = api.infoCollect.getConfig.useQuery();
  const bannerUrl = config?.bannerUrl ?? null;

  const submitMutation = api.infoCollect.submit.useMutation({
    onSuccess: () => {
      setStep('submitted');
      toast.success('提交成功！');
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  // 钉钉免登获取 authCode → 调用后端获取用户信息
  useEffect(() => {
    void (async () => {
      try {
        const dd = await import('dingtalk-jsapi');
        console.log('[DingTalk] platform:', dd.env.platform);

        if (dd.env.platform === 'notInDingTalk') {
          setErrorMsg('请在钉钉客户端内打开此页面');
          setStep('error');
          return;
        }

        const corpId = new URLSearchParams(window.location.search).get(
          'corpId',
        );
        console.log('[DingTalk] corpId:', corpId);
        if (!corpId) {
          setErrorMsg('缺少 corpId 参数，请检查应用配置');
          setStep('error');
          return;
        }

        console.log('[DingTalk] requestAuthCode start');
        const info = await dd.runtime.permission.requestAuthCode({ corpId });
        console.log(
          '[DingTalk] authCode obtained:',
          info.code?.slice(0, 8),
          '...',
        );

        console.log('[DingTalk] fetching user-info...');
        const res = await fetch('/api/dingtalk/user-info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ authCode: info.code }),
        });
        const data = (await res.json()) as {
          success: boolean;
          data?: DingtalkUserInfo;
          errorMsg?: string;
        };
        console.log(
          '[DingTalk] user-info response:',
          data.success,
          data.errorMsg,
        );
        if (!data.success || !data.data) {
          setErrorMsg(data.errorMsg ?? '获取用户信息失败');
          setStep('error');
          return;
        }
        setUserInfo(data.data);
        setStep('form');
      } catch (err) {
        console.error('[DingTalk] 免登失败:', err);
        setErrorMsg('钉钉免登失败，请重试');
        setStep('error');
      }
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ID_CARD_RE.test(idCard)) {
      setIdCardError('请输入有效的身份证号');
      return;
    }
    setIdCardError('');

    // 重新获取 authCode，因为初始 authCode 已在获取用户信息时被消耗
    const corpId = new URLSearchParams(window.location.search).get('corpId');
    if (!corpId) {
      toast.error('缺少 corpId 参数');
      return;
    }
    try {
      const dd = await import('dingtalk-jsapi');
      const info = await dd.runtime.permission.requestAuthCode({ corpId });
      submitMutation.mutate({ authCode: info.code, idCard });
    } catch {
      toast.error('获取授权码失败，请重试');
    }
  }

  // 加载中
  if (step === 'loading') {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{
          background:
            'linear-gradient(180deg, #3B82F6 0%, #60A5FA 40%, #93C5FD 100%)',
        }}
      >
        <div className="text-center text-white">
          <div className="mb-2 text-lg">正在获取用户信息...</div>
          <div className="text-sm opacity-80">请稍候</div>
        </div>
      </div>
    );
  }

  // 错误
  if (step === 'error') {
    return (
      <div
        className="flex min-h-screen items-center justify-center p-4"
        style={{
          background:
            'linear-gradient(180deg, #3B82F6 0%, #60A5FA 40%, #93C5FD 100%)',
        }}
      >
        <div
          className="w-full max-w-md rounded-2xl p-8 text-center"
          style={{
            backdropFilter: 'blur(30px)',
            WebkitBackdropFilter: 'blur(30px)',
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,1) 56%)',
          }}
        >
          <div className="mb-4 text-4xl">&#9888;</div>
          <p className="text-gray-600">{errorMsg}</p>
        </div>
      </div>
    );
  }

  // 提交成功
  if (step === 'submitted') {
    return (
      <div
        className="flex min-h-screen items-center justify-center p-4"
        style={{
          background:
            'linear-gradient(180deg, #3B82F6 0%, #60A5FA 40%, #93C5FD 100%)',
        }}
      >
        <div
          className="w-full max-w-md rounded-2xl p-8 text-center"
          style={{
            backdropFilter: 'blur(30px)',
            WebkitBackdropFilter: 'blur(30px)',
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,1) 56%)',
          }}
        >
          <div className="mb-4 text-5xl">&#10004;</div>
          <h2 className="mb-2 font-bold text-gray-800 text-xl">提交成功</h2>
          <p className="mb-6 text-gray-500">您的信息已提交，我们将尽快审核。</p>
          <a
            className="inline-block rounded-lg bg-blue-500 px-6 py-2.5 font-medium text-white transition-colors hover:bg-blue-600"
            href="/info-collect/query"
          >
            查询进度
          </a>
        </div>
      </div>
    );
  }

  // 表单
  return (
    <div
      className="flex min-h-screen flex-col items-center"
      style={{
        background:
          'linear-gradient(180deg, #3B82F6 0%, #60A5FA 40%, #93C5FD 100%)',
      }}
    >
      {bannerUrl && (
        // biome-ignore lint/performance/noImgElement: dynamic user-uploaded src
        <img alt="Banner" className="w-full object-cover" src={bannerUrl} />
      )}

      <div
        className={`w-full max-w-md px-4 ${bannerUrl ? 'mt-4' : 'mt-12'} pb-8`}
      >
        <div
          className="w-full rounded-2xl"
          style={{
            backdropFilter: 'blur(30px)',
            WebkitBackdropFilter: 'blur(30px)',
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,1) 56%)',
          }}
        >
          <div className="p-6">
            <h1 className="mb-1 text-center font-bold text-gray-800 text-xl">
              在职{MODULE_NAME}
            </h1>
            <p className="mb-6 text-center text-gray-400 text-sm">
              以下信息已从钉钉自动获取
            </p>

            {/* 钉钉用户信息（只读展示） */}
            <div className="mb-6 space-y-3 rounded-lg bg-gray-50 p-4">
              {[
                { label: '姓名', value: userInfo?.name },
                { label: '手机号', value: userInfo?.mobile },
                { label: '部门', value: userInfo?.department },
                { label: '职位', value: userInfo?.position },
                { label: '工号', value: userInfo?.jobNumber },
              ].map(
                (item) =>
                  item.value && (
                    <div
                      className="flex items-center justify-between"
                      key={item.label}
                    >
                      <span className="text-gray-500 text-sm">
                        {item.label}
                      </span>
                      <span className="font-medium text-gray-800 text-sm">
                        {item.value}
                      </span>
                    </div>
                  ),
              )}
            </div>

            {/* 身份证号（手动填写） */}
            <form className="space-y-4" onSubmit={handleSubmit}>
              <label className="block">
                <span className="mb-1 block font-medium text-gray-700 text-sm">
                  身份证号 <span className="text-red-500">*</span>
                </span>
                <input
                  className={`w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${idCardError ? 'border-red-400' : 'border-gray-300'}`}
                  maxLength={18}
                  onChange={(e) => {
                    setIdCard(e.target.value.toUpperCase());
                    setIdCardError('');
                  }}
                  placeholder="请输入18位身份证号"
                  type="text"
                  value={idCard}
                />
                {idCardError && (
                  <p className="mt-1 text-red-500 text-xs">{idCardError}</p>
                )}
              </label>

              <button
                className="w-full rounded-lg bg-blue-500 py-3 font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={submitMutation.isPending}
                type="submit"
              >
                {submitMutation.isPending ? '提交中...' : '提交信息'}
              </button>

              <p className="text-center text-gray-400 text-xs">
                提交后可在「查询进度」中查看审核状态
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
