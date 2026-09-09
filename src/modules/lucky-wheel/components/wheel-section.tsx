'use client';

import { useEffect, useRef, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { isDingtalkEnabled } from '@/lib/auth-methods';
import { useDingtalkAutoLogin } from '@/lib/use-dingtalk-auto-login';
import { MyPrizesSheet } from '@/modules/lucky-wheel/components/wheel/my-prizes-sheet';
import { UserInfoModal } from '@/modules/lucky-wheel/components/wheel/user-info-modal';
import type { Prize } from '@/modules/lucky-wheel/components/wheel/wheel-container';
import { WheelContainer } from '@/modules/lucky-wheel/components/wheel/wheel-container';
import { api } from '@/trpc/react';

interface WheelSectionProps {
  activityId: string;
  prizes: Prize[];
  initialLoggedIn: boolean;
}

type UserInfo = { name: string; address: string };

const localKey = (id: string) => `lucky-wheel-userinfo-${id}`;

function readLocalUserInfo(activityId: string): UserInfo | null {
  try {
    const raw = localStorage.getItem(localKey(activityId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'name' in parsed &&
      'address' in parsed &&
      typeof (parsed as UserInfo).name === 'string' &&
      typeof (parsed as UserInfo).address === 'string'
    ) {
      return parsed as UserInfo;
    }
  } catch {
    // ignore
  }
  return null;
}

function writeLocalUserInfo(activityId: string, info: UserInfo) {
  try {
    localStorage.setItem(localKey(activityId), JSON.stringify(info));
  } catch {
    // ignore
  }
}

export function WheelSection({
  activityId,
  prizes,
  initialLoggedIn,
}: WheelSectionProps) {
  const { data: session, isPending: isSessionLoading } =
    authClient.useSession();
  const isLoggedIn = isSessionLoading ? initialLoggedIn : !!session?.user;

  // 钉钉免登：仅在 dingtalk 模式且未登录时触发。
  // 钉钉外打开（not-in-dingtalk / missing-corp-id）或免登失败（failed）时不阻塞，
  // 直接放行到 UserInfoModal 的手机验证码表单作为回退登录通道。
  const dtEnabled = isDingtalkEnabled && !isSessionLoading && !isLoggedIn;
  const dt = useDingtalkAutoLogin({ enabled: dtEnabled });
  // hook 启用后到 effect 把状态置为 pending 之间有一帧仍是 idle，一并视为进行中，
  // 否则 Modal 会在免登开始前闪现一下
  const dtInProgress =
    dt.status === 'pending' || (dtEnabled && dt.status === 'idle');

  // mounted 标志：SSR/hydration 阶段不渲染 Modal，待客户端 localStorage 读取完毕后再判断
  const [mounted, setMounted] = useState(false);
  const [localUserInfo, setLocalUserInfo] = useState<UserInfo | null>(null);

  useEffect(() => {
    setLocalUserInfo(readLocalUserInfo(activityId));
    setMounted(true);
  }, [activityId]);

  // 查询 DB 中最近一次的 userInfo（已抽奖用户）
  const { data: savedUserInfo, isLoading: isLoadingUserInfo } =
    api.luckyWheel.record.getMyUserInfo.useQuery(
      { activityId },
      { enabled: isLoggedIn },
    );

  // 优先级：DB 历史 > localStorage > null（触发弹窗）
  const userInfo =
    (savedUserInfo?.name && savedUserInfo?.address
      ? { name: savedUserInfo.name, address: savedUserInfo.address }
      : null) ?? localUserInfo;

  function handleModalSuccess(info: UserInfo) {
    writeLocalUserInfo(activityId, info);
    setLocalUserInfo(info);
  }

  // mounted 前不显示 Modal（避免 SSR hydration 闪现）
  // session 加载中不显示（避免 isPending 期间 isLoggedIn 短暂翻转导致弹窗闪现）
  // 登录用户：DB 查询期间也不显示（isLoadingUserInfo 为 true 时阻断）
  // 钉钉免登进行中（pending）也不显示：免登成功后即为已登录，弹窗会白闪一下
  const showModal =
    mounted &&
    !isSessionLoading &&
    !dtInProgress &&
    (!isLoggedIn || (!isLoadingUserInfo && !userInfo));

  // 用 ref 暴露打开"我的奖品"的方法给 WheelContainer 的回调
  const prizesSheetRef = useRef<{ open: () => void }>(null);

  return (
    <>
      <UserInfoModal
        defaultName={session?.user?.name}
        fallbackHint={
          // 钉钉内免登失败才提示；浏览器打开走验证码是正常路径，不需要解释。
          // dt.error 已由 hook 经 resolveAuthError 翻成中文（如「钉钉账号未绑定有效手机号」），
          // 优先展示具体原因，取不到时退回通用文案。
          dt.status === 'failed'
            ? dt.error
              ? `${dt.error}，请使用手机验证码登录`
              : '钉钉免登失败，请使用手机验证码登录'
            : undefined
        }
        loggedIn={isLoggedIn}
        onSuccess={handleModalSuccess}
        open={showModal}
      />
      <WheelContainer
        activityId={activityId}
        address={userInfo?.address}
        isLoggedIn={isLoggedIn}
        name={userInfo?.name}
        onViewPrizes={() => prizesSheetRef.current?.open()}
        prizes={prizes}
      />
      <MyPrizesSheet isLoggedIn={isLoggedIn} ref={prizesSheetRef} />
    </>
  );
}
