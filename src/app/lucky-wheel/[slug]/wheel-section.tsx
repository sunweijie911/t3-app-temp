'use client';

import { useEffect, useState } from 'react';
import { authClient } from '@/lib/auth-client';
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
  const { data: session } = authClient.useSession();
  const isLoggedIn = session !== undefined ? !!session?.user : initialLoggedIn;

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
  // 登录用户：DB 查询期间也不显示（isLoadingUserInfo 为 true 时阻断）
  const showModal =
    mounted && (!isLoggedIn || (!isLoadingUserInfo && !userInfo));

  return (
    <>
      <UserInfoModal
        loggedIn={isLoggedIn}
        onSuccess={handleModalSuccess}
        open={showModal}
      />
      <WheelContainer
        activityId={activityId}
        address={userInfo?.address}
        isLoggedIn={isLoggedIn}
        name={userInfo?.name}
        prizes={prizes}
      />
    </>
  );
}
