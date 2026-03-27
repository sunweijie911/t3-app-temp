'use client';

import { useEffect, useRef, useState } from 'react';

import { openLink } from '@/lib/dingtalk-utils';
import {
  SimCardHomeSkeleton,
  SimCardPackageSkeletonList,
} from '@/modules/sim-card/components/home-skeleton';
import { SimCardPackageCard } from '@/modules/sim-card/components/package-card';
import { MODULE_NAME, USER_INFO_FIELDS } from '@/modules/sim-card/constants';
import { SkeletonBlock } from '@/shared/components/skeleton';
import { api } from '@/trpc/react';

interface DingtalkUserInfo {
  name: string;
  userid: string;
  mobile: string;
  position: string;
  department: string;
  jobNumber: string;
}

type Step = 'loading' | 'ready' | 'error';

export default function SimCardHome() {
  const [step, setStep] = useState<Step>('loading');
  const [userInfo, setUserInfo] = useState<DingtalkUserInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  // 存储最新可用的 authCode（用于埋点）
  const authCodeRef = useRef('');

  const { data: packages, isLoading: packagesLoading } =
    api.simCard.list.useQuery();
  const { data: bannerUrl } = api.simCard.bannerUrl.useQuery();
  const { data: visibleFields } = api.simCard.visibleFields.useQuery();

  const trackClickMutation = api.simCard.trackClick.useMutation({
    onError: (err) => console.warn('埋点记录失败:', err.message),
  });

  // 钉钉免登获取用户信息
  useEffect(() => {
    void (async () => {
      try {
        const dd = await import('dingtalk-jsapi');

        if (dd.env.platform === 'notInDingTalk') {
          setErrorMsg('请在钉钉客户端内打开此页面');
          setStep('error');
          return;
        }

        const corpId = new URLSearchParams(window.location.search).get(
          'corpId',
        );
        if (!corpId) {
          setErrorMsg('缺少 corpId 参数，请检查应用配置');
          setStep('error');
          return;
        }

        const info = await dd.runtime.permission.requestAuthCode({ corpId });
        authCodeRef.current = info.code;

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

        if (!data.success || !data.data) {
          setErrorMsg(data.errorMsg ?? '获取用户信息失败');
          setStep('error');
          return;
        }

        setUserInfo(data.data);
        setStep('ready');
      } catch (err) {
        console.error('[DingTalk] 免登失败:', err);
        setErrorMsg('钉钉免登失败，请重试');
        setStep('error');
      }
    })();
  }, []);

  // 点击办理：先埋点，再跳转
  async function handleBuy(packageId: string, link: string) {
    // 重新获取 authCode
    try {
      const corpId = new URLSearchParams(window.location.search).get('corpId');
      if (corpId) {
        const dd = await import('dingtalk-jsapi');
        const info = await dd.runtime.permission.requestAuthCode({ corpId });
        authCodeRef.current = info.code;
      }
    } catch {
      // 获取新 authCode 失败，用旧的
    }

    // 记录埋点（不阻塞跳转）
    if (authCodeRef.current) {
      trackClickMutation.mutate({
        packageId,
        authCode: authCodeRef.current,
      });
    }

    // 跳转
    openLink(link);
  }

  // 获取用户信息字段映射
  const fieldMap: Record<string, string | undefined> = userInfo
    ? {
        name: userInfo.name,
        phone: userInfo.mobile,
        department: userInfo.department,
        position: userInfo.position,
        jobNumber: userInfo.jobNumber,
      }
    : {};

  // 加载中
  if (step === 'loading') {
    return <SimCardHomeSkeleton />;
  }

  // 错误
  if (step === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <div className="mb-4 text-4xl">&#9888;</div>
          <p className="text-gray-600">{errorMsg}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Banner */}
      {packagesLoading && !bannerUrl ? (
        <div className="px-3 pt-3">
          <SkeletonBlock className="aspect-video w-full" rounded="2xl" />
        </div>
      ) : bannerUrl ? (
        <div className="px-3 pt-3">
          {/* biome-ignore lint/performance/noImgElement: 动态上传图片 */}
          <img
            alt={MODULE_NAME}
            className="aspect-video w-full rounded-2xl object-cover"
            src={bannerUrl}
          />
        </div>
      ) : null}

      {/* 用户信息卡片 */}
      {userInfo && visibleFields && visibleFields.length > 0 && (
        <div className="mx-3 mt-3 rounded-2xl bg-white p-4 shadow-sm">
          <div className="space-y-2.5">
            {USER_INFO_FIELDS.filter((f) => visibleFields.includes(f.key)).map(
              (field) => {
                const value = fieldMap[field.key];
                if (!value) return null;
                return (
                  <div
                    className="flex items-center justify-between"
                    key={field.key}
                  >
                    <span className="text-gray-500 text-sm">{field.label}</span>
                    <span className="font-medium text-gray-800 text-sm">
                      {value}
                    </span>
                  </div>
                );
              },
            )}
          </div>
        </div>
      )}

      {/* 套餐卡片列表 */}
      <div className="space-y-3 px-3 pt-3 pb-8">
        {packagesLoading && <SimCardPackageSkeletonList count={3} />}

        {!packagesLoading && (!packages || packages.length === 0) && (
          <div className="py-20 text-center text-gray-400">暂无可用套餐</div>
        )}

        {packages?.map((pkg) => (
          <SimCardPackageCard
            callMinutes={pkg.callMinutes}
            cardBgColor={pkg.cardBgColor}
            carrier={pkg.carrier}
            dataAllowance={pkg.dataAllowance}
            description={pkg.description}
            detailImageUrl={pkg.detailImageUrl}
            highlights={pkg.highlights ?? []}
            imageUrl={pkg.imageUrl}
            key={pkg.id}
            monthlyPrice={pkg.monthlyPrice}
            onBuy={(link) => handleBuy(pkg.id, link)}
            purchaseLink={pkg.purchaseLink}
            title={pkg.title}
          />
        ))}
      </div>
    </div>
  );
}
