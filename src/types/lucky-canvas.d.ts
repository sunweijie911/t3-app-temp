declare module '@lucky-canvas/react' {
  import type { CSSProperties, Ref } from 'react';

  interface LuckyWheelFont {
    text: string;
    top?: string;
    fontColor?: string;
    fontSize?: string;
    fontStyle?: string;
    fontWeight?: string;
    lineHeight?: string;
    wordWrap?: boolean;
    lengthLimit?: string;
    lineClamp?: number;
  }

  interface LuckyWheelImg {
    src: string;
    top?: string;
    width?: string;
    height?: string;
    rotate?: boolean;
  }

  interface LuckyWheelBlock {
    padding?: string;
    background?: string;
    imgs?: LuckyWheelImg[];
  }

  interface LuckyWheelPrize {
    range?: number;
    background?: string;
    fonts?: LuckyWheelFont[];
    imgs?: LuckyWheelImg[];
  }

  interface LuckyWheelButton {
    radius?: string;
    pointer?: boolean;
    background?: string;
    fonts?: LuckyWheelFont[];
    imgs?: LuckyWheelImg[];
  }

  interface LuckyWheelDefaultConfig {
    gutter?: string;
    stopRange?: number;
    offsetDegree?: number;
    speed?: number;
    accelerationTime?: number;
    decelerationTime?: number;
  }

  interface LuckyWheelDefaultStyle {
    background?: string;
    fontColor?: string;
    fontSize?: string;
    fontStyle?: string;
    fontWeight?: string;
    lineHeight?: string;
    wordWrap?: boolean;
    lengthLimit?: string;
    lineClamp?: number;
  }

  interface LuckyWheelRef {
    play: () => void;
    stop: (index: number) => void;
    init: () => void;
  }

  interface LuckyWheelProps {
    ref?: Ref<LuckyWheelRef>;
    width: string | number;
    height: string | number;
    blocks?: LuckyWheelBlock[];
    prizes?: LuckyWheelPrize[];
    buttons?: LuckyWheelButton[];
    defaultConfig?: LuckyWheelDefaultConfig;
    defaultStyle?: LuckyWheelDefaultStyle;
    onStart?: () => void;
    onEnd?: (prize: LuckyWheelPrize) => void;
    style?: CSSProperties;
    className?: string;
  }

  export function LuckyWheel(props: LuckyWheelProps): JSX.Element;

  // LuckyGrid is also available but not used
  export function LuckyGrid(props: Record<string, unknown>): JSX.Element;
}
