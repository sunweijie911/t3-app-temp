'use client';

import { useEffect, useState } from 'react';
import { useVConsole } from '@/modules/info-collect/components/use-vconsole';
import { REVIEW_STATUS_LABELS } from '@/modules/info-collect/constants';
import { api } from '@/trpc/react';

const STATUS_ICONS: Record<string, string> = {
  pending: '\u23F3',
  approved: '\u2705',
  rejected: '\u274C',
  needs_supplement: '\u270F\uFE0F',
  completed: '\uD83D\uDCE6',
};

type Step = 'loading' | 'ready' | 'error';

export default function InfoCollectQueryPage() {
  useVConsole();
  const [step, setStep] = useState<Step>('loading');
  const [authCode, setAuthCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const { data: records, isFetching } = api.infoCollect.query.useQuery(
    { authCode },
    {
      enabled: !!authCode,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  );

  // 钉钉免登获取 authCode
  useEffect(() => {
    void (async () => {
      const dd = await import('dingtalk-jsapi');

      if (dd.env.platform === 'notInDingTalk') {
        setErrorMsg('请在钉钉客户端内打开此页面');
        setStep('error');
        return;
      }

      const corpId = new URLSearchParams(window.location.search).get('corpId');
      if (!corpId) {
        setErrorMsg('缺少 corpId 参数，请检查应用配置');
        setStep('error');
        return;
      }

      dd.ready(async () => {
        try {
          const info = await dd.runtime.permission.requestAuthCode({
            corpId,
          });
          setAuthCode(info.code);
          setStep('ready');
        } catch {
          setErrorMsg('钉钉免登失败，请重试');
          setStep('error');
        }
      });
    })();
  }, []);

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

  return (
    <div
      className="flex min-h-screen items-center justify-center p-4"
      style={{
        background:
          'linear-gradient(180deg, #3B82F6 0%, #60A5FA 40%, #93C5FD 100%)',
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6"
        style={{
          backdropFilter: 'blur(30px)',
          WebkitBackdropFilter: 'blur(30px)',
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,1) 56%)',
        }}
      >
        <h1 className="mb-1 text-center font-bold text-gray-800 text-xl">
          进度查询
        </h1>
        <p className="mb-6 text-center text-gray-400 text-sm">
          自动查询您的审核进度
        </p>

        {/* 加载中 */}
        {(step === 'loading' || isFetching) && (
          <div className="py-8 text-center text-gray-400 text-sm">
            查询中...
          </div>
        )}

        {/* 查询结果 */}
        {step === 'ready' && !isFetching && (
          <div>
            {!records || records.length === 0 ? (
              <div className="py-4 text-center text-gray-400 text-sm">
                未找到相关记录
              </div>
            ) : (
              <div className="space-y-3">
                {records.map((r) => (
                  <div
                    className="rounded-lg border border-gray-200 bg-white p-4"
                    key={r.id}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-medium text-gray-700 text-sm">
                        {STATUS_ICONS[r.status] ?? ''}{' '}
                        {REVIEW_STATUS_LABELS[r.status] ?? r.status}
                      </span>
                      <span className="text-gray-400 text-xs">
                        {new Date(r.createdAt).toLocaleDateString('zh-CN')}
                      </span>
                    </div>

                    {r.status === 'rejected' && r.rejectReason && (
                      <div>
                        <p className="mt-1 text-red-500 text-xs">
                          拒绝原因：{r.rejectReason}
                        </p>
                        <a
                          className="mt-1 inline-block text-blue-500 text-xs hover:text-blue-600"
                          href="/info-collect"
                        >
                          重新提交 &rarr;
                        </a>
                      </div>
                    )}

                    {r.status === 'needs_supplement' && r.rejectReason && (
                      <div>
                        <p className="mt-1 text-orange-500 text-xs">
                          需补充：{r.rejectReason}
                        </p>
                        <a
                          className="mt-1 inline-block text-blue-500 text-xs hover:text-blue-600"
                          href="/info-collect"
                        >
                          重新提交 &rarr;
                        </a>
                      </div>
                    )}

                    {r.status === 'completed' && r.trackingNumber && (
                      <p className="mt-1 text-green-600 text-xs">
                        发货单号：{r.trackingNumber}
                      </p>
                    )}

                    {r.status === 'approved' && (
                      <p className="mt-1 text-blue-500 text-xs">
                        审核已通过，等待发货
                      </p>
                    )}

                    {r.status === 'pending' && (
                      <p className="mt-1 text-gray-400 text-xs">
                        正在审核中，请耐心等待
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 text-center">
              <a
                className="text-blue-500 text-sm hover:text-blue-600"
                href="/info-collect"
              >
                返回信息采集
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
