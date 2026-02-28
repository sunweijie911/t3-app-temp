import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { nanoid } from 'nanoid';
import postgres from 'postgres';
import * as schema from '@/server/db/schema';
import { questions, systemConfig, testTypes } from '@/server/db/schema';

const conn = postgres(process.env.DATABASE_URL!);
const db = drizzle(conn, { schema });

// ============================================================
// Test Type Definitions
// ============================================================

interface TestTypeSeed {
  id: string;
  name: string;
  slug: string;
  description: string;
  shortDescription: string;
  scoringStrategy: 'dimension' | 'category' | 'scale' | 'composite';
  scoringConfig: Record<string, unknown>;
  resultDefinitions: Record<string, unknown>;
  questionCount: number;
  estimatedMinutes: number;
  isFeatured: boolean;
  sortOrder: number;
  reportPrice: string;
}

const testTypeSeeds: TestTypeSeed[] = [
  // 1. MBTI
  {
    id: nanoid(),
    name: 'MBTI 16型人格',
    slug: 'mbti',
    description:
      'MBTI（迈尔斯-布里格斯类型指标）是目前全球最流行的人格测评工具之一。它基于荣格心理类型理论，通过四个维度将人格分为16种类型，帮助你了解自己的思维方式、决策模式和行为偏好。无论是在职业规划、人际关系还是自我成长方面，MBTI都能为你提供有价值的参考。',
    shortDescription: '探索你的16型人格，了解你的思维方式与行为偏好',
    scoringStrategy: 'dimension',
    scoringConfig: {
      dimensions: [
        { id: 'EI', labels: ['外向 E', '内向 I'] },
        { id: 'SN', labels: ['实感 S', '直觉 N'] },
        { id: 'TF', labels: ['思考 T', '情感 F'] },
        { id: 'JP', labels: ['判断 J', '感知 P'] },
      ],
    },
    resultDefinitions: {
      INTJ: {
        code: 'INTJ',
        label: '建筑师',
        description: '富有想象力和战略性的思考者，一切皆在计划之中',
      },
      INTP: {
        code: 'INTP',
        label: '逻辑学家',
        description: '具有创造力的发明家，对知识有着不可抑制的渴望',
      },
      ENTJ: {
        code: 'ENTJ',
        label: '指挥官',
        description: '大胆、富有想象力且意志坚强的领导者',
      },
      ENTP: {
        code: 'ENTP',
        label: '辩论家',
        description: '聪明好奇的思考者，不会放弃任何智力上的挑战',
      },
      INFJ: {
        code: 'INFJ',
        label: '提倡者',
        description: '安静而神秘，同时鼓舞人心且不知疲倦的理想主义者',
      },
      INFP: {
        code: 'INFP',
        label: '调停者',
        description: '诗意、善良的利他主义者，总是热情地为正义事业提供帮助',
      },
      ENFJ: {
        code: 'ENFJ',
        label: '主人公',
        description: '富有魅力和鼓舞力量的领导者，能够吸引听众',
      },
      ENFP: {
        code: 'ENFP',
        label: '竞选者',
        description: '热情、有创造力、社交自由的人，总能找到理由微笑',
      },
      ISTJ: {
        code: 'ISTJ',
        label: '物流师',
        description: '实际且注重事实的人，其可靠性不容怀疑',
      },
      ISFJ: {
        code: 'ISFJ',
        label: '守卫者',
        description: '非常专注且热情的守护者，时刻准备着保护所爱之人',
      },
      ESTJ: {
        code: 'ESTJ',
        label: '总经理',
        description: '出色的管理者，在管理事务或人员方面无与伦比',
      },
      ESFJ: {
        code: 'ESFJ',
        label: '执政官',
        description: '极有同情心、爱交际、受欢迎的人，总是热心帮助',
      },
      ISTP: {
        code: 'ISTP',
        label: '鉴赏家',
        description: '大胆而实际的实验家，擅长使用各种形式的工具',
      },
      ISFP: {
        code: 'ISFP',
        label: '探险家',
        description: '灵活有魅力的艺术家，时刻准备着探索和体验新事物',
      },
      ESTP: {
        code: 'ESTP',
        label: '企业家',
        description: '聪明、精力充沛且善于感知的人，真正享受生活的边缘',
      },
      ESFP: {
        code: 'ESFP',
        label: '表演者',
        description: '自发、精力充沛且热情的人——生活在他们身边永远不会无聊',
      },
    },
    questionCount: 20,
    estimatedMinutes: 10,
    isFeatured: true,
    sortOrder: 1,
    reportPrice: '9.90',
  },

  // 2. Enneagram 九型人格
  {
    id: nanoid(),
    name: '九型人格',
    slug: 'enneagram',
    description:
      '九型人格是一种深入探索人类内心动机的人格分类系统。它将人格分为九种基本类型，每种类型都有独特的核心恐惧、核心渴望和行为模式。通过了解自己的九型人格类型，你可以更深入地认识自己的行为动机，发现自我成长的方向，改善与他人的关系。',
    shortDescription: '探索你的核心动机与行为模式，发现成长方向',
    scoringStrategy: 'category',
    scoringConfig: {
      categories: [
        { id: '1', label: '类型一：改革者' },
        { id: '2', label: '类型二：助人者' },
        { id: '3', label: '类型三：成就者' },
        { id: '4', label: '类型四：个人主义者' },
        { id: '5', label: '类型五：调查者' },
        { id: '6', label: '类型六：忠诚者' },
        { id: '7', label: '类型七：热情者' },
        { id: '8', label: '类型八：挑战者' },
        { id: '9', label: '类型九：和平者' },
      ],
    },
    resultDefinitions: {
      '1': {
        code: '1',
        label: '改革者',
        description: '理性、理想主义，有原则、有目标、自律且追求完美',
      },
      '2': {
        code: '2',
        label: '助人者',
        description: '关怀他人、人际导向，慷慨、讨好型且占有欲强',
      },
      '3': {
        code: '3',
        label: '成就者',
        description: '适应力强、追求成功，有驱动力、注重形象且高效',
      },
      '4': {
        code: '4',
        label: '个人主义者',
        description: '敏感、内省，富有表现力、戏剧性、自我关注且任性',
      },
      '5': {
        code: '5',
        label: '调查者',
        description: '强烈、理智型，有洞察力、创新性，但可能孤立和疏远',
      },
      '6': {
        code: '6',
        label: '忠诚者',
        description: '忠诚、安全导向，有责任心、焦虑且多疑',
      },
      '7': {
        code: '7',
        label: '热情者',
        description: '忙碌、乐观，多才多艺、自发性强但容易分心',
      },
      '8': {
        code: '8',
        label: '挑战者',
        description: '强势、主导型，自信、果断、意志坚强且具有对抗性',
      },
      '9': {
        code: '9',
        label: '和平者',
        description: '随和、自我消除型，接受力强、信任他人且有时过于顺从',
      },
    },
    questionCount: 18,
    estimatedMinutes: 10,
    isFeatured: true,
    sortOrder: 2,
    reportPrice: '9.90',
  },

  // 3. Big Five 大五人格
  {
    id: nanoid(),
    name: '大五人格测试',
    slug: 'big-five',
    description:
      '大五人格模型（又称OCEAN模型）是当今心理学研究中最被广泛接受的人格理论。它从开放性、尽责性、外向性、宜人性和神经质五个维度全面描述人格特质。与其他人格测试不同，大五人格基于扎实的实证研究，能够更准确地预测个体在工作和生活中的表现。',
    shortDescription: '基于科学研究的五维度人格评估，全面了解你的性格特质',
    scoringStrategy: 'scale',
    scoringConfig: {
      dimensions: [
        { id: 'O', label: '开放性', min: 1, max: 5 },
        { id: 'C', label: '尽责性', min: 1, max: 5 },
        { id: 'E', label: '外向性', min: 1, max: 5 },
        { id: 'A', label: '宜人性', min: 1, max: 5 },
        { id: 'N', label: '神经质', min: 1, max: 5 },
      ],
    },
    resultDefinitions: {
      high_O: {
        label: '高开放性',
        description: '富有创造力、好奇心强，乐于接受新体验',
      },
      low_O: { label: '低开放性', description: '务实、传统，偏好熟悉的事物' },
      high_C: { label: '高尽责性', description: '自律、有条理，目标导向' },
      low_C: { label: '低尽责性', description: '灵活、随性，适应力强' },
      high_E: { label: '高外向性', description: '热情、社交活跃，精力充沛' },
      low_E: { label: '低外向性', description: '安静、内敛，独处时最自在' },
      high_A: { label: '高宜人性', description: '合作、信任他人，为人和善' },
      low_A: { label: '低宜人性', description: '独立、竞争意识强，直言不讳' },
      high_N: {
        label: '高神经质',
        description: '情感丰富、敏感，容易感到压力',
      },
      low_N: { label: '低神经质', description: '情绪稳定、冷静，抗压力强' },
    },
    questionCount: 25,
    estimatedMinutes: 12,
    isFeatured: true,
    sortOrder: 3,
    reportPrice: '9.90',
  },

  // 4. DISC
  {
    id: nanoid(),
    name: 'DISC 行为风格测试',
    slug: 'disc',
    description:
      'DISC行为风格测试是企业中广泛使用的团队沟通和领导力评估工具。它从支配型(D)、影响型(I)、稳定型(S)和谨慎型(C)四个维度分析你的行为风格，帮助你了解自己在团队中的角色、沟通方式和领导风格，从而提升团队协作效率。',
    shortDescription: '了解你的行为风格，提升沟通与领导力',
    scoringStrategy: 'category',
    scoringConfig: {
      categories: [
        { id: 'D', label: '支配型 Dominance' },
        { id: 'I', label: '影响型 Influence' },
        { id: 'S', label: '稳定型 Steadiness' },
        { id: 'C', label: '谨慎型 Conscientiousness' },
      ],
    },
    resultDefinitions: {
      D: {
        code: 'D',
        label: '支配型',
        description: '果断、竞争、有魄力，追求结果和效率，喜欢掌控局面',
      },
      I: {
        code: 'I',
        label: '影响型',
        description: '热情、乐观、善于社交，喜欢与人互动，注重人际关系',
      },
      S: {
        code: 'S',
        label: '稳定型',
        description: '耐心、可靠、善于倾听，重视团队和谐，不喜欢突然的变化',
      },
      C: {
        code: 'C',
        label: '谨慎型',
        description: '分析性强、注重细节、追求准确，做事有条理，重视质量',
      },
    },
    questionCount: 16,
    estimatedMinutes: 8,
    isFeatured: false,
    sortOrder: 4,
    reportPrice: '9.90',
  },

  // 5. Holland RIASEC
  {
    id: nanoid(),
    name: '霍兰德职业兴趣测试',
    slug: 'holland',
    description:
      '霍兰德职业兴趣测试（RIASEC）是由美国心理学家约翰·霍兰德提出的职业兴趣理论。它将人的职业兴趣分为六种类型：实际型、研究型、艺术型、社会型、企业型和常规型。通过了解你的职业兴趣类型组合，可以帮助你找到最适合自己的职业方向和发展路径。',
    shortDescription: '发现你的职业兴趣类型，找到最适合的职业方向',
    scoringStrategy: 'category',
    scoringConfig: {
      categories: [
        { id: 'R', label: '实际型 Realistic' },
        { id: 'I', label: '研究型 Investigative' },
        { id: 'A', label: '艺术型 Artistic' },
        { id: 'S', label: '社会型 Social' },
        { id: 'E', label: '企业型 Enterprising' },
        { id: 'C', label: '常规型 Conventional' },
      ],
    },
    resultDefinitions: {
      R: {
        code: 'R',
        label: '实际型',
        description: '喜欢动手操作、户外活动，偏好具体的任务和明确的结果',
      },
      I: {
        code: 'I',
        label: '研究型',
        description: '好奇、分析能力强，喜欢研究和解决复杂问题',
      },
      A: {
        code: 'A',
        label: '艺术型',
        description: '富有创造力、想象力丰富，追求自我表达和美的体验',
      },
      S: {
        code: 'S',
        label: '社会型',
        description: '善于与人交流、乐于助人，喜欢教育和服务他人',
      },
      E: {
        code: 'E',
        label: '企业型',
        description: '有领导力、善于说服，喜欢管理和影响他人',
      },
      C: {
        code: 'C',
        label: '常规型',
        description: '细致有条理、遵守规则，喜欢有组织的工作环境',
      },
    },
    questionCount: 18,
    estimatedMinutes: 10,
    isFeatured: true,
    sortOrder: 5,
    reportPrice: '9.90',
  },

  // 6. Love Languages
  {
    id: nanoid(),
    name: '爱情语言测试',
    slug: 'love-languages',
    description:
      '爱情语言测试源自盖瑞·查普曼博士的《爱的五种语言》理论。每个人表达和接收爱的方式不同，了解自己和伴侣的爱情语言，能帮助你们更好地沟通感情，减少误解，建立更深层的情感连接。这个测试将帮助你发现最能触动你内心的爱的表达方式。',
    shortDescription: '发现你表达和接收爱的方式，改善亲密关系',
    scoringStrategy: 'category',
    scoringConfig: {
      categories: [
        { id: 'words', label: '肯定的言辞' },
        { id: 'time', label: '精心的时刻' },
        { id: 'gifts', label: '接收礼物' },
        { id: 'service', label: '服务的行动' },
        { id: 'touch', label: '身体的接触' },
      ],
    },
    resultDefinitions: {
      words: {
        code: 'words',
        label: '肯定的言辞',
        description: '你最需要通过语言来感受爱——真诚的赞美、鼓励和"我爱你"',
      },
      time: {
        code: 'time',
        label: '精心的时刻',
        description: '你最需要对方全心全意的陪伴——高质量的共处时光让你感到被爱',
      },
      gifts: {
        code: 'gifts',
        label: '接收礼物',
        description: '用心准备的礼物最能打动你——礼物背后的心意让你感受到爱',
      },
      service: {
        code: 'service',
        label: '服务的行动',
        description: '为你做事最能表达爱——分担家务、照顾你的日常让你感到被关心',
      },
      touch: {
        code: 'touch',
        label: '身体的接触',
        description:
          '肢体接触最能表达爱——拥抱、牵手和亲密接触让你感到安全和被爱',
      },
    },
    questionCount: 15,
    estimatedMinutes: 8,
    isFeatured: false,
    sortOrder: 6,
    reportPrice: '9.90',
  },

  // 7. Attachment Style
  {
    id: nanoid(),
    name: '依恋类型测试',
    slug: 'attachment-style',
    description:
      '依恋理论由心理学家约翰·鲍尔比和玛丽·安斯沃斯提出，是理解亲密关系的重要心理学框架。你的依恋类型形成于早期与照料者的互动，并深刻影响着你成年后的亲密关系模式。了解自己的依恋类型，可以帮助你理解在感情中的反应模式，并学习如何建立更健康的关系。',
    shortDescription: '了解你的依恋模式，建立更健康的亲密关系',
    scoringStrategy: 'category',
    scoringConfig: {
      categories: [
        { id: 'secure', label: '安全型' },
        { id: 'anxious', label: '焦虑型' },
        { id: 'avoidant', label: '回避型' },
        { id: 'disorganized', label: '混乱型' },
      ],
    },
    resultDefinitions: {
      secure: {
        code: 'secure',
        label: '安全型依恋',
        description: '你在关系中感到自在，既能亲密也能独立，信任伴侣',
      },
      anxious: {
        code: 'anxious',
        label: '焦虑型依恋',
        description: '你渴望亲密但常担心被抛弃，需要频繁的确认和关注',
      },
      avoidant: {
        code: 'avoidant',
        label: '回避型依恋',
        description: '你重视独立，在关系过于亲密时感到不适，倾向于保持距离',
      },
      disorganized: {
        code: 'disorganized',
        label: '混乱型依恋',
        description: '你对亲密关系既渴望又恐惧，情感反应常常矛盾',
      },
    },
    questionCount: 16,
    estimatedMinutes: 8,
    isFeatured: false,
    sortOrder: 7,
    reportPrice: '9.90',
  },

  // 8. Mental Age
  {
    id: nanoid(),
    name: '心理年龄测试',
    slug: 'mental-age',
    description:
      '心理年龄与实际年龄并不总是相符。有些人虽然年轻，却有着超越年龄的成熟和智慧；有些人虽已年长，却保持着年轻的心态和活力。这个测试将通过你的思维方式、生活态度和行为习惯来评估你的心理年龄，帮助你更好地了解自己内心的真实状态。',
    shortDescription: '测测你的心理年龄是多少？也许和你想的不一样',
    scoringStrategy: 'scale',
    scoringConfig: {
      dimensions: [{ id: 'mentalAge', label: '心理年龄', min: 1, max: 5 }],
      ageMapping: {
        '1.0-1.5': '15-18岁',
        '1.5-2.0': '18-22岁',
        '2.0-2.5': '22-28岁',
        '2.5-3.0': '28-35岁',
        '3.0-3.5': '35-45岁',
        '3.5-4.0': '45-55岁',
        '4.0-4.5': '55-65岁',
        '4.5-5.0': '65岁以上',
      },
    },
    resultDefinitions: {
      teen: {
        label: '少年心态 (15-18岁)',
        description: '你拥有青少年的好奇心和冒险精神，充满活力和幻想',
      },
      young_adult: {
        label: '青年心态 (18-28岁)',
        description: '你正处于探索自我和世界的黄金时期，充满热情和理想',
      },
      adult: {
        label: '成熟心态 (28-45岁)',
        description: '你的心智已趋成熟，能够理性地看待问题，责任感强',
      },
      senior: {
        label: '智者心态 (45岁以上)',
        description: '你拥有丰富的人生阅历和智慧，看待事物更加通透和豁达',
      },
    },
    questionCount: 15,
    estimatedMinutes: 8,
    isFeatured: true,
    sortOrder: 8,
    reportPrice: '9.90',
  },

  // 9. Human Feeling
  {
    id: nanoid(),
    name: '人类情感光谱测试',
    slug: 'human-feeling',
    description:
      '每个人感知和表达情感的方式都是独特的。人类情感光谱测试从快乐感知、共情能力、心理韧性、情感敏感度和热情指数五个维度，绘制出属于你的情感画像。了解自己的情感光谱，能帮助你更好地管理情绪，增强情感智慧，建立更深层的人际连接。',
    shortDescription: '绘制你的情感画像，探索内心的情感世界',
    scoringStrategy: 'composite',
    scoringConfig: {
      dimensions: [
        { id: 'joy', label: '快乐', weight: 1 },
        { id: 'empathy', label: '共情', weight: 1 },
        { id: 'resilience', label: '韧性', weight: 1 },
        { id: 'sensitivity', label: '敏感', weight: 1 },
        { id: 'passion', label: '热情', weight: 1 },
      ],
    },
    resultDefinitions: {
      balanced: {
        label: '均衡型',
        description: '你的情感发展均衡，各维度表现稳定',
      },
      empathetic: {
        label: '共情主导型',
        description: '你具有极强的共情能力，能够深刻感受他人的情绪',
      },
      resilient: {
        label: '韧性主导型',
        description: '你拥有强大的心理韧性，面对逆境能够快速恢复',
      },
      passionate: {
        label: '热情主导型',
        description: '你充满热情和活力，对生活和事业都有强烈的投入感',
      },
      sensitive: {
        label: '敏感主导型',
        description: '你的情感天线非常敏锐，能够捕捉到细微的情感变化',
      },
    },
    questionCount: 15,
    estimatedMinutes: 8,
    isFeatured: false,
    sortOrder: 9,
    reportPrice: '9.90',
  },

  // 10. Dark Triad
  {
    id: nanoid(),
    name: '暗黑人格三联征测试',
    slug: 'dark-triad',
    description:
      '暗黑人格三联征（Dark Triad）是心理学中用于描述三种具有社会厌恶特质的人格特征：自恋、马基雅维利主义和精神变态。虽然名称听起来令人不安，但每个人或多或少都具有这些特质。了解自己在这些维度上的程度，可以帮助你更客观地认识自己，意识到自身的潜在倾向，从而做出更有意识的行为选择。',
    shortDescription: '探索你人格中的暗黑面，更客观地认识自己',
    scoringStrategy: 'scale',
    scoringConfig: {
      dimensions: [
        { id: 'N', label: '自恋', min: 1, max: 5 },
        { id: 'M', label: '马基雅维利主义', min: 1, max: 5 },
        { id: 'P', label: '精神变态', min: 1, max: 5 },
      ],
    },
    resultDefinitions: {
      high_N: {
        label: '高自恋',
        description: '你有较强的自我关注和优越感，渴望他人的认可和赞美',
      },
      low_N: {
        label: '低自恋',
        description: '你比较谦逊，不太在意外界的关注和评价',
      },
      high_M: {
        label: '高马基雅维利主义',
        description: '你善于策略思考，注重实际利益，行事灵活',
      },
      low_M: {
        label: '低马基雅维利主义',
        description: '你行事正直，不太倾向于使用策略手段达成目的',
      },
      high_P: {
        label: '高精神变态',
        description: '你的情感反应较淡，善于冷静地做出决策，不太受情感干扰',
      },
      low_P: {
        label: '低精神变态',
        description: '你的情感丰富，重视他人的感受和社会规范',
      },
    },
    questionCount: 15,
    estimatedMinutes: 8,
    isFeatured: false,
    sortOrder: 10,
    reportPrice: '9.90',
  },
];

// ============================================================
// Question Definitions
// ============================================================

interface QuestionSeed {
  testSlug: string;
  text: string;
  dimension?: string;
  options: Array<{
    value: string;
    label: string;
    score?: number;
    dimension?: string;
  }>;
}

const questionSeeds: QuestionSeed[] = [
  // ============================================================
  // MBTI Questions (20)
  // ============================================================
  // EI dimension
  {
    testSlug: 'mbti',
    text: '在社交聚会中，你通常会：',
    dimension: 'EI',
    options: [
      { value: 'E', label: '主动与很多人交谈，包括陌生人', dimension: 'EI' },
      { value: 'I', label: '只和少数你认识的人交谈', dimension: 'EI' },
    ],
  },
  {
    testSlug: 'mbti',
    text: '周末的理想活动是：',
    dimension: 'EI',
    options: [
      { value: 'E', label: '参加朋友聚会或社交活动', dimension: 'EI' },
      { value: 'I', label: '在家安静地阅读或独处', dimension: 'EI' },
    ],
  },
  {
    testSlug: 'mbti',
    text: '工作一整天后，你倾向于通过什么方式充电？',
    dimension: 'EI',
    options: [
      { value: 'E', label: '和朋友出去吃饭聊天', dimension: 'EI' },
      { value: 'I', label: '回家独自休息放松', dimension: 'EI' },
    ],
  },
  {
    testSlug: 'mbti',
    text: '在团队讨论中，你更可能：',
    dimension: 'EI',
    options: [
      { value: 'E', label: '积极发言并带动讨论氛围', dimension: 'EI' },
      { value: 'I', label: '仔细思考后才选择性发言', dimension: 'EI' },
    ],
  },
  {
    testSlug: 'mbti',
    text: '你认识新朋友时通常：',
    dimension: 'EI',
    options: [
      { value: 'E', label: '很快就能熟络起来，打开话题', dimension: 'EI' },
      { value: 'I', label: '需要较长时间才能敞开心扉', dimension: 'EI' },
    ],
  },
  // SN dimension
  {
    testSlug: 'mbti',
    text: '处理信息时，你更注重：',
    dimension: 'SN',
    options: [
      { value: 'S', label: '具体的事实和细节', dimension: 'SN' },
      { value: 'N', label: '整体的模式和可能性', dimension: 'SN' },
    ],
  },
  {
    testSlug: 'mbti',
    text: '做决定时，你更依赖：',
    dimension: 'SN',
    options: [
      { value: 'S', label: '过去的经验和已验证的方法', dimension: 'SN' },
      { value: 'N', label: '直觉和未来的愿景', dimension: 'SN' },
    ],
  },
  {
    testSlug: 'mbti',
    text: '你对以下哪种描述更有共鸣？',
    dimension: 'SN',
    options: [
      { value: 'S', label: '我关注当下正在发生的事情', dimension: 'SN' },
      { value: 'N', label: '我经常想象未来可能发生什么', dimension: 'SN' },
    ],
  },
  {
    testSlug: 'mbti',
    text: '阅读一本书时，你更关注：',
    dimension: 'SN',
    options: [
      { value: 'S', label: '具体的故事情节和事实描述', dimension: 'SN' },
      { value: 'N', label: '隐含的主题和深层含义', dimension: 'SN' },
    ],
  },
  {
    testSlug: 'mbti',
    text: '学习新技能时，你更喜欢：',
    dimension: 'SN',
    options: [
      { value: 'S', label: '按照步骤一步步实操练习', dimension: 'SN' },
      { value: 'N', label: '先理解整体框架和原理', dimension: 'SN' },
    ],
  },
  // TF dimension
  {
    testSlug: 'mbti',
    text: '朋友向你倾诉烦恼时，你更倾向于：',
    dimension: 'TF',
    options: [
      { value: 'T', label: '分析问题并提供解决方案', dimension: 'TF' },
      { value: 'F', label: '先理解他们的感受并给予安慰', dimension: 'TF' },
    ],
  },
  {
    testSlug: 'mbti',
    text: '做重要决定时，你更看重：',
    dimension: 'TF',
    options: [
      { value: 'T', label: '逻辑分析和客观事实', dimension: 'TF' },
      { value: 'F', label: '个人价值观和对他人的影响', dimension: 'TF' },
    ],
  },
  {
    testSlug: 'mbti',
    text: '在评价他人的工作时，你更倾向于：',
    dimension: 'TF',
    options: [
      { value: 'T', label: '直接指出不足之处以帮助改进', dimension: 'TF' },
      { value: 'F', label: '先肯定优点再委婉提出建议', dimension: 'TF' },
    ],
  },
  {
    testSlug: 'mbti',
    text: '面对冲突时，你更看重：',
    dimension: 'TF',
    options: [
      { value: 'T', label: '找出事实真相和公正解决', dimension: 'TF' },
      { value: 'F', label: '维护关系和照顾各方感受', dimension: 'TF' },
    ],
  },
  {
    testSlug: 'mbti',
    text: '你认为好的领导者应该：',
    dimension: 'TF',
    options: [
      { value: 'T', label: '基于数据和逻辑做出公正决策', dimension: 'TF' },
      { value: 'F', label: '理解团队成员的需求并激励人心', dimension: 'TF' },
    ],
  },
  // JP dimension
  {
    testSlug: 'mbti',
    text: '你的日常生活方式更接近：',
    dimension: 'JP',
    options: [
      { value: 'J', label: '有计划和时间表，喜欢按计划行事', dimension: 'JP' },
      { value: 'P', label: '随性灵活，喜欢随机应变', dimension: 'JP' },
    ],
  },
  {
    testSlug: 'mbti',
    text: '面对即将到来的截止日期，你通常：',
    dimension: 'JP',
    options: [
      { value: 'J', label: '提前完成，不喜欢拖到最后', dimension: 'JP' },
      { value: 'P', label: '在截止日前的压力下效率最高', dimension: 'JP' },
    ],
  },
  {
    testSlug: 'mbti',
    text: '出去旅行时，你更喜欢：',
    dimension: 'JP',
    options: [
      { value: 'J', label: '提前规划好行程和住宿', dimension: 'JP' },
      { value: 'P', label: '随心所欲地探索，保持灵活', dimension: 'JP' },
    ],
  },
  {
    testSlug: 'mbti',
    text: '你的工作桌面通常是：',
    dimension: 'JP',
    options: [
      { value: 'J', label: '整洁有序，物品各归其位', dimension: 'JP' },
      { value: 'P', label: '看似凌乱但我知道东西在哪', dimension: 'JP' },
    ],
  },
  {
    testSlug: 'mbti',
    text: '当计划突然改变时，你的反应是：',
    dimension: 'JP',
    options: [
      { value: 'J', label: '感到不适，希望能回到原计划', dimension: 'JP' },
      { value: 'P', label: '觉得无所谓，甚至有些兴奋', dimension: 'JP' },
    ],
  },

  // ============================================================
  // Enneagram Questions (18)
  // ============================================================
  {
    testSlug: 'enneagram',
    text: '你最看重的个人品质是：',
    dimension: 'type',
    options: [
      { value: '1', label: '正直和自律——做正确的事情' },
      { value: '3', label: '效率和成就——完成目标最重要' },
      { value: '6', label: '忠诚和责任——对团队负责到底' },
    ],
  },
  {
    testSlug: 'enneagram',
    text: '在帮助他人时，你最常有的感受是：',
    dimension: 'type',
    options: [
      { value: '2', label: '帮助别人让我感到被需要和满足' },
      { value: '9', label: '我愿意配合他人以维持和谐' },
      { value: '5', label: '我更愿意提供知识和分析而非情感支持' },
    ],
  },
  {
    testSlug: 'enneagram',
    text: '面对批评时，你的第一反应通常是：',
    dimension: 'type',
    options: [
      { value: '1', label: '审视自己是否真的做错了' },
      { value: '4', label: '感到被误解，内心受伤' },
      { value: '8', label: '感到愤怒，想要反驳' },
    ],
  },
  {
    testSlug: 'enneagram',
    text: '在压力下，你最可能出现的行为是：',
    dimension: 'type',
    options: [
      { value: '7', label: '寻找新的刺激和活动来转移注意力' },
      { value: '5', label: '退缩到自己的内心世界中思考' },
      { value: '3', label: '更加努力工作以证明自己' },
    ],
  },
  {
    testSlug: 'enneagram',
    text: '你最害怕的是：',
    dimension: 'type',
    options: [
      { value: '6', label: '没有安全感和支持' },
      { value: '4', label: '平庸和没有独特的身份' },
      { value: '2', label: '不被他人需要和爱' },
    ],
  },
  {
    testSlug: 'enneagram',
    text: '在社交场合中，你通常：',
    dimension: 'type',
    options: [
      { value: '7', label: '是活跃的气氛制造者' },
      { value: '5', label: '在角落安静地观察' },
      { value: '3', label: '展示自己最好的一面' },
    ],
  },
  {
    testSlug: 'enneagram',
    text: '你对规则和权威的态度是：',
    dimension: 'type',
    options: [
      { value: '1', label: '尊重并遵守合理的规则' },
      { value: '8', label: '不喜欢被约束，更愿意自己做主' },
      { value: '6', label: '既想遵守又会质疑其合理性' },
    ],
  },
  {
    testSlug: 'enneagram',
    text: '在亲密关系中，你最需要的是：',
    dimension: 'type',
    options: [
      { value: '2', label: '感受到自己是被对方深深需要的' },
      { value: '4', label: '与对方有深层的情感连接和理解' },
      { value: '9', label: '和谐稳定，没有太多冲突' },
    ],
  },
  {
    testSlug: 'enneagram',
    text: '工作中你最引以为豪的是：',
    dimension: 'type',
    options: [
      { value: '3', label: '我的成绩和获得的认可' },
      { value: '1', label: '我的专业态度和工作质量' },
      { value: '5', label: '我的专业知识和洞察力' },
    ],
  },
  {
    testSlug: 'enneagram',
    text: '面对新的机会时，你的态度是：',
    dimension: 'type',
    options: [
      { value: '7', label: '兴奋地想要尝试一切新事物' },
      { value: '6', label: '先评估风险再做决定' },
      { value: '9', label: '如果不打扰现状就可以接受' },
    ],
  },
  {
    testSlug: 'enneagram',
    text: '你内心最深处的渴望是：',
    dimension: 'type',
    options: [
      { value: '4', label: '被真正理解，找到自己的独特意义' },
      { value: '8', label: '掌控自己的命运，不受他人支配' },
      { value: '2', label: '被无条件地爱和接纳' },
    ],
  },
  {
    testSlug: 'enneagram',
    text: '当事情不如预期时，你会：',
    dimension: 'type',
    options: [
      { value: '1', label: '反复检查哪里出了问题并纠正' },
      { value: '7', label: '迅速转向其他更有趣的事情' },
      { value: '9', label: '试图接受现状，避免冲突' },
    ],
  },
  {
    testSlug: 'enneagram',
    text: '你的朋友最常用什么词来形容你？',
    dimension: 'type',
    options: [
      { value: '8', label: '有魄力、直接、强势' },
      { value: '2', label: '温暖、体贴、无私' },
      { value: '5', label: '聪明、独立、深思熟虑' },
    ],
  },
  {
    testSlug: 'enneagram',
    text: '在做重大决定时，你最看重：',
    dimension: 'type',
    options: [
      { value: '3', label: '这个选择能否帮我达成目标' },
      { value: '6', label: '这个选择的安全性和可靠性' },
      { value: '4', label: '这个选择是否符合我的内心感受' },
    ],
  },
  {
    testSlug: 'enneagram',
    text: '独处时你最常做的事情是：',
    dimension: 'type',
    options: [
      { value: '5', label: '阅读或研究感兴趣的课题' },
      { value: '4', label: '沉浸在音乐、艺术或想象中' },
      { value: '7', label: '计划下一次冒险或有趣的活动' },
    ],
  },
  {
    testSlug: 'enneagram',
    text: '你觉得自己最大的弱点是：',
    dimension: 'type',
    options: [
      { value: '1', label: '过于追求完美，对自己和他人要求太高' },
      { value: '9', label: '太容易妥协，忽视自己的需求' },
      { value: '8', label: '太强势，有时不够顾及他人感受' },
    ],
  },
  {
    testSlug: 'enneagram',
    text: '你认为成功意味着：',
    dimension: 'type',
    options: [
      { value: '3', label: '获得社会认可和高成就' },
      { value: '1', label: '按照自己的标准活出正直的人生' },
      { value: '7', label: '体验丰富多彩的人生' },
    ],
  },
  {
    testSlug: 'enneagram',
    text: '在团队合作中，你最自然的角色是：',
    dimension: 'type',
    options: [
      { value: '8', label: '领导者——做决定并推动执行' },
      { value: '2', label: '协调者——关注每个人的需求' },
      { value: '6', label: '守护者——预防风险保障安全' },
    ],
  },

  // ============================================================
  // Big Five Questions (25) - Likert scale 1-5
  // ============================================================
  // Openness (O)
  {
    testSlug: 'big-five',
    text: '我对艺术和美有很强的感受力',
    dimension: 'O',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'big-five',
    text: '我喜欢尝试新的和不同的事物',
    dimension: 'O',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'big-five',
    text: '我经常沉浸在自己的想象世界中',
    dimension: 'O',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'big-five',
    text: '我对不同的哲学观点和文化持开放态度',
    dimension: 'O',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'big-five',
    text: '我喜欢思考抽象的概念和理论',
    dimension: 'O',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  // Conscientiousness (C)
  {
    testSlug: 'big-five',
    text: '我总是按照计划和时间表行事',
    dimension: 'C',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'big-five',
    text: '我做事非常注重细节',
    dimension: 'C',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'big-five',
    text: '我很少拖延重要的任务',
    dimension: 'C',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'big-five',
    text: '我的生活和工作空间通常很整洁',
    dimension: 'C',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'big-five',
    text: '我会坚持不懈地完成我开始的任务',
    dimension: 'C',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  // Extraversion (E)
  {
    testSlug: 'big-five',
    text: '我喜欢成为人群中的焦点',
    dimension: 'E',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'big-five',
    text: '我很容易和陌生人开始交谈',
    dimension: 'E',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'big-five',
    text: '参加社交活动让我感到精力充沛',
    dimension: 'E',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'big-five',
    text: '我是一个话比较多、活跃的人',
    dimension: 'E',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'big-five',
    text: '我喜欢参加有很多人的聚会和活动',
    dimension: 'E',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  // Agreeableness (A)
  {
    testSlug: 'big-five',
    text: '我很容易信任他人',
    dimension: 'A',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'big-five',
    text: '我总是考虑他人的感受',
    dimension: 'A',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'big-five',
    text: '在争论中我倾向于寻找妥协和共识',
    dimension: 'A',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'big-five',
    text: '我乐于帮助需要帮助的人',
    dimension: 'A',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'big-five',
    text: '我很少对别人发脾气',
    dimension: 'A',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  // Neuroticism (N)
  {
    testSlug: 'big-five',
    text: '我经常感到焦虑和担忧',
    dimension: 'N',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'big-five',
    text: '我的情绪容易波动',
    dimension: 'N',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'big-five',
    text: '遇到压力时我容易感到沮丧',
    dimension: 'N',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'big-five',
    text: '我常常过度担心一些事情',
    dimension: 'N',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'big-five',
    text: '小事情有时会让我很烦躁',
    dimension: 'N',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },

  // ============================================================
  // DISC Questions (16)
  // ============================================================
  {
    testSlug: 'disc',
    text: '在团队中遇到分歧时，你倾向于：',
    dimension: 'style',
    options: [
      { value: 'D', label: '果断决策，让团队快速前进' },
      { value: 'I', label: '通过热情讨论达成共识' },
      { value: 'S', label: '耐心倾听各方意见，寻找折中方案' },
      { value: 'C', label: '收集数据进行分析后再做决定' },
    ],
  },
  {
    testSlug: 'disc',
    text: '你最不能忍受的工作环境是：',
    dimension: 'style',
    options: [
      { value: 'D', label: '效率低下、没有挑战' },
      { value: 'I', label: '沉闷无趣、缺乏交流' },
      { value: 'S', label: '变化太快、充满不确定性' },
      { value: 'C', label: '混乱无序、标准模糊' },
    ],
  },
  {
    testSlug: 'disc',
    text: '在完成一个项目时，你最看重：',
    dimension: 'style',
    options: [
      { value: 'D', label: '结果和效率' },
      { value: 'I', label: '过程中的团队合作和创意' },
      { value: 'S', label: '稳定的进展和团队和谐' },
      { value: 'C', label: '质量和准确性' },
    ],
  },
  {
    testSlug: 'disc',
    text: '别人初次见到你时，可能觉得你：',
    dimension: 'style',
    options: [
      { value: 'D', label: '自信果断、有威严感' },
      { value: 'I', label: '热情开朗、容易亲近' },
      { value: 'S', label: '温和友好、平易近人' },
      { value: 'C', label: '认真专注、沉着冷静' },
    ],
  },
  {
    testSlug: 'disc',
    text: '你处理紧急任务的方式是：',
    dimension: 'style',
    options: [
      { value: 'D', label: '立即行动，边做边调整' },
      { value: 'I', label: '先召集团队讨论再行动' },
      { value: 'S', label: '按照既定流程有序处理' },
      { value: 'C', label: '先分析情况，制定详细计划再执行' },
    ],
  },
  {
    testSlug: 'disc',
    text: '你最大的优势是：',
    dimension: 'style',
    options: [
      { value: 'D', label: '决断力和执行力' },
      { value: 'I', label: '人际关系和影响力' },
      { value: 'S', label: '耐心和可靠性' },
      { value: 'C', label: '分析能力和精准度' },
    ],
  },
  {
    testSlug: 'disc',
    text: '在会议中，你通常的角色是：',
    dimension: 'style',
    options: [
      { value: 'D', label: '主导讨论方向，推动决策' },
      { value: 'I', label: '活跃气氛，分享创意想法' },
      { value: 'S', label: '倾听并支持团队的方向' },
      { value: 'C', label: '提出关键问题，确保方案严谨' },
    ],
  },
  {
    testSlug: 'disc',
    text: '当你对某件事不满意时，你会：',
    dimension: 'style',
    options: [
      { value: 'D', label: '直接表达不满并要求改变' },
      { value: 'I', label: '用幽默或间接的方式提出' },
      { value: 'S', label: '自己忍耐或等待合适时机再说' },
      { value: 'C', label: '列出具体问题和改进建议' },
    ],
  },
  {
    testSlug: 'disc',
    text: '你理想的工作方式是：',
    dimension: 'style',
    options: [
      { value: 'D', label: '独立负责一个项目，追求高效' },
      { value: 'I', label: '与人互动频繁，充满创意' },
      { value: 'S', label: '有明确的流程和稳定的环境' },
      { value: 'C', label: '有充足时间做深入的分析研究' },
    ],
  },
  {
    testSlug: 'disc',
    text: '面对失败时，你的第一反应是：',
    dimension: 'style',
    options: [
      { value: 'D', label: '立刻寻找新的解决方案' },
      { value: 'I', label: '保持乐观，相信下次会更好' },
      { value: 'S', label: '需要时间来调整和接受' },
      { value: 'C', label: '复盘分析失败的原因' },
    ],
  },
  {
    testSlug: 'disc',
    text: '你认为好的沟通方式应该是：',
    dimension: 'style',
    options: [
      { value: 'D', label: '简洁直接，重点突出' },
      { value: 'I', label: '生动有趣，充满感染力' },
      { value: 'S', label: '温和耐心，充分倾听' },
      { value: 'C', label: '逻辑清晰，数据支撑' },
    ],
  },
  {
    testSlug: 'disc',
    text: '学习新技能时，你更倾向于：',
    dimension: 'style',
    options: [
      { value: 'D', label: '快速掌握要点后直接实践' },
      { value: 'I', label: '在互动和讨论中学习' },
      { value: 'S', label: '循序渐进，反复练习' },
      { value: 'C', label: '先充分理解原理再开始' },
    ],
  },
  {
    testSlug: 'disc',
    text: '你在压力下通常的表现是：',
    dimension: 'style',
    options: [
      { value: 'D', label: '变得更加专注和强硬' },
      { value: 'I', label: '情绪波动较大，需要他人支持' },
      { value: 'S', label: '变得退缩，不愿表达' },
      { value: 'C', label: '变得更加谨慎和保守' },
    ],
  },
  {
    testSlug: 'disc',
    text: '你对待变化的态度是：',
    dimension: 'style',
    options: [
      { value: 'D', label: '欢迎变化，因为变化带来机会' },
      { value: 'I', label: '如果变化有趣就接受' },
      { value: 'S', label: '需要时间适应，更喜欢稳定' },
      { value: 'C', label: '只接受有充分论证的变化' },
    ],
  },
  {
    testSlug: 'disc',
    text: '在团队中你最希望被认可的是：',
    dimension: 'style',
    options: [
      { value: 'D', label: '我的领导力和成果' },
      { value: 'I', label: '我的创意和人脉' },
      { value: 'S', label: '我的可靠和团队贡献' },
      { value: 'C', label: '我的专业能力和精准度' },
    ],
  },
  {
    testSlug: 'disc',
    text: '你挑选合作伙伴时最看重：',
    dimension: 'style',
    options: [
      { value: 'D', label: '能力强、执行力高' },
      { value: 'I', label: '有趣、有创造力' },
      { value: 'S', label: '可靠、守信用' },
      { value: 'C', label: '严谨、有专业精神' },
    ],
  },

  // ============================================================
  // Holland RIASEC Questions (18)
  // ============================================================
  {
    testSlug: 'holland',
    text: '以下哪个活动最吸引你？',
    dimension: 'interest',
    options: [
      { value: 'R', label: '组装和修理机械设备' },
      { value: 'I', label: '进行科学实验和研究' },
      { value: 'A', label: '创作艺术作品或音乐' },
    ],
  },
  {
    testSlug: 'holland',
    text: '你更喜欢什么样的工作环境？',
    dimension: 'interest',
    options: [
      { value: 'S', label: '与人互动密切，帮助他人成长' },
      { value: 'E', label: '充满竞争和商业机会' },
      { value: 'C', label: '有条理的办公环境，处理数据' },
    ],
  },
  {
    testSlug: 'holland',
    text: '如果可以自由选择，你最想做的事情是：',
    dimension: 'interest',
    options: [
      { value: 'R', label: '在户外进行体力活动或手工制作' },
      { value: 'A', label: '写小说、画画或设计' },
      { value: 'I', label: '研究一个复杂的学术问题' },
    ],
  },
  {
    testSlug: 'holland',
    text: '在学校里你最喜欢的课程类型是：',
    dimension: 'interest',
    options: [
      { value: 'I', label: '科学、数学等理论课程' },
      { value: 'A', label: '艺术、音乐、文学等创意课程' },
      { value: 'S', label: '社会学、心理学等人文课程' },
    ],
  },
  {
    testSlug: 'holland',
    text: '你认为自己最突出的能力是：',
    dimension: 'interest',
    options: [
      { value: 'R', label: '动手能力和空间感知' },
      { value: 'E', label: '说服力和组织管理能力' },
      { value: 'C', label: '数据处理和行政管理能力' },
    ],
  },
  {
    testSlug: 'holland',
    text: '空闲时间你最可能在做什么？',
    dimension: 'interest',
    options: [
      { value: 'R', label: 'DIY手工或运动健身' },
      { value: 'I', label: '阅读科普文章或纪录片' },
      { value: 'A', label: '去美术馆、看电影或玩音乐' },
    ],
  },
  {
    testSlug: 'holland',
    text: '你最期望的职业成就感来源于：',
    dimension: 'interest',
    options: [
      { value: 'S', label: '帮助他人解决问题或获得成长' },
      { value: 'E', label: '领导团队达成商业目标' },
      { value: 'C', label: '建立高效的系统和流程' },
    ],
  },
  {
    testSlug: 'holland',
    text: '以下哪个角色最符合你的理想？',
    dimension: 'interest',
    options: [
      { value: 'R', label: '工程师或技术专家' },
      { value: 'I', label: '科学家或研究员' },
      { value: 'A', label: '设计师或艺术家' },
    ],
  },
  {
    testSlug: 'holland',
    text: '你更认同哪种工作价值观？',
    dimension: 'interest',
    options: [
      { value: 'S', label: '工作应该服务社会和帮助他人' },
      { value: 'E', label: '工作应该带来权力和经济回报' },
      { value: 'C', label: '工作应该有序、稳定、可预期' },
    ],
  },
  {
    testSlug: 'holland',
    text: '面对一个新项目，你最想负责的部分是：',
    dimension: 'interest',
    options: [
      { value: 'R', label: '动手实施和技术搭建' },
      { value: 'I', label: '前期调研和方案设计' },
      { value: 'E', label: '商务谈判和资源整合' },
    ],
  },
  {
    testSlug: 'holland',
    text: '你最有成就感的时刻是：',
    dimension: 'interest',
    options: [
      { value: 'R', label: '亲手制作或修理好一样东西' },
      { value: 'A', label: '完成一件自己满意的创意作品' },
      { value: 'S', label: '看到自己帮助的人获得进步' },
    ],
  },
  {
    testSlug: 'holland',
    text: '如果开一家公司，你最想做：',
    dimension: 'interest',
    options: [
      { value: 'E', label: '负责战略规划和市场拓展' },
      { value: 'C', label: '负责财务管理和运营流程' },
      { value: 'I', label: '负责产品研发和技术创新' },
    ],
  },
  {
    testSlug: 'holland',
    text: '你认为以下哪个描述最像你？',
    dimension: 'interest',
    options: [
      { value: 'R', label: '我喜欢实际操作，不太喜欢纯理论' },
      { value: 'A', label: '我有丰富的想象力和独特的审美' },
      { value: 'C', label: '我做事有条理，注重细节和规范' },
    ],
  },
  {
    testSlug: 'holland',
    text: '在朋友眼中，你最擅长的是：',
    dimension: 'interest',
    options: [
      { value: 'S', label: '倾听和给予建议' },
      { value: 'E', label: '组织活动和带领大家' },
      { value: 'I', label: '解释复杂的事情让人理解' },
    ],
  },
  {
    testSlug: 'holland',
    text: '选择职业时，你最看重：',
    dimension: 'interest',
    options: [
      { value: 'R', label: '能够运用技术和动手操作' },
      { value: 'A', label: '能够发挥创造力和自由表达' },
      { value: 'S', label: '能够与人互动并帮助他人' },
    ],
  },
  {
    testSlug: 'holland',
    text: '遇到技术难题时，你的反应是：',
    dimension: 'interest',
    options: [
      { value: 'R', label: '动手拆解看看内部结构' },
      { value: 'I', label: '查阅资料研究原理' },
      { value: 'C', label: '按照说明书一步步排查' },
    ],
  },
  {
    testSlug: 'holland',
    text: '你更享受哪种学习方式？',
    dimension: 'interest',
    options: [
      { value: 'R', label: '实践操作和动手实验' },
      { value: 'I', label: '理论研究和独立思考' },
      { value: 'S', label: '小组讨论和互动学习' },
    ],
  },
  {
    testSlug: 'holland',
    text: '如果有一笔资金，你最想投入的方向是：',
    dimension: 'interest',
    options: [
      { value: 'E', label: '创业或商业投资' },
      { value: 'A', label: '支持艺术创作或文化项目' },
      { value: 'C', label: '稳健的理财和系统化投资' },
    ],
  },

  // ============================================================
  // Love Languages Questions (15)
  // ============================================================
  {
    testSlug: 'love-languages',
    text: '在情人节，你最希望收到什么？',
    dimension: 'language',
    options: [
      { value: 'words', label: '一封深情的情书或真挚的表白' },
      { value: 'gifts', label: '一份精心准备的礼物' },
      { value: 'time', label: '一整天不受打扰的二人世界' },
    ],
  },
  {
    testSlug: 'love-languages',
    text: '以下哪种行为最让你感到被爱？',
    dimension: 'language',
    options: [
      { value: 'service', label: '对方主动为你做饭或打扫房间' },
      { value: 'touch', label: '对方给你一个温暖的拥抱' },
      { value: 'words', label: '对方说"你对我来说很重要"' },
    ],
  },
  {
    testSlug: 'love-languages',
    text: '你更希望伴侣用什么方式安慰你？',
    dimension: 'language',
    options: [
      { value: 'touch', label: '默默地拥抱你，给你肩膀依靠' },
      { value: 'words', label: '用温柔的话语鼓励和安慰你' },
      { value: 'time', label: '放下所有事情陪在你身边' },
    ],
  },
  {
    testSlug: 'love-languages',
    text: '伴侣的哪种行为最能打动你？',
    dimension: 'language',
    options: [
      { value: 'gifts', label: '记住你随口提到想要的东西并买给你' },
      { value: 'service', label: '在你忙碌时默默帮你处理家务' },
      { value: 'time', label: '关掉手机全身心地和你聊天' },
    ],
  },
  {
    testSlug: 'love-languages',
    text: '你在关系中最害怕什么？',
    dimension: 'language',
    options: [
      { value: 'words', label: '对方很少表达感情或肯定你' },
      { value: 'touch', label: '对方排斥肢体接触' },
      { value: 'time', label: '对方总是很忙，没时间陪你' },
    ],
  },
  {
    testSlug: 'love-languages',
    text: '你表达爱意时最常用的方式是：',
    dimension: 'language',
    options: [
      { value: 'words', label: '经常说"我爱你"和赞美对方' },
      { value: 'service', label: '为对方做各种事情让TA轻松' },
      { value: 'gifts', label: '给对方准备惊喜和小礼物' },
    ],
  },
  {
    testSlug: 'love-languages',
    text: '和伴侣在一起时，最让你开心的是：',
    dimension: 'language',
    options: [
      { value: 'time', label: '一起做有趣的事情，享受共处时光' },
      { value: 'touch', label: '牵着手散步或依偎在一起' },
      { value: 'words', label: '听对方分享生活和想法' },
    ],
  },
  {
    testSlug: 'love-languages',
    text: '你觉得最浪漫的事情是：',
    dimension: 'language',
    options: [
      { value: 'gifts', label: '在特别的日子收到意想不到的礼物' },
      { value: 'time', label: '两个人一起去旅行，不受打扰' },
      { value: 'service', label: '对方为你精心准备一顿烛光晚餐' },
    ],
  },
  {
    testSlug: 'love-languages',
    text: '如果感到和伴侣关系疏远，你最希望TA：',
    dimension: 'language',
    options: [
      { value: 'touch', label: '给你一个长长的拥抱' },
      { value: 'words', label: '认真地告诉你TA多在乎你' },
      { value: 'time', label: '专门安排时间和你谈心' },
    ],
  },
  {
    testSlug: 'love-languages',
    text: '你最记得伴侣做过的哪类事情？',
    dimension: 'language',
    options: [
      { value: 'words', label: '对你说过的暖心话语' },
      { value: 'gifts', label: '送给你的特别礼物' },
      { value: 'service', label: '在你困难时默默帮你做的事' },
    ],
  },
  {
    testSlug: 'love-languages',
    text: '以下哪种约会方式你最向往？',
    dimension: 'language',
    options: [
      { value: 'time', label: '安静的咖啡馆里深入交谈' },
      { value: 'touch', label: '看电影时依偎在一起' },
      { value: 'gifts', label: '收到一份用心挑选的礼物后一起庆祝' },
    ],
  },
  {
    testSlug: 'love-languages',
    text: '长距离恋爱中你最难忍受的是：',
    dimension: 'language',
    options: [
      { value: 'touch', label: '不能拥抱和牵手' },
      { value: 'time', label: '不能面对面相处' },
      { value: 'words', label: '对方回消息不积极，很少说爱你' },
    ],
  },
  {
    testSlug: 'love-languages',
    text: '你生日时最期待的是：',
    dimension: 'language',
    options: [
      { value: 'gifts', label: '一份精心准备的生日礼物' },
      { value: 'service', label: '对方包办一整天让你完全放松' },
      { value: 'words', label: '一段发自内心的生日祝福' },
    ],
  },
  {
    testSlug: 'love-languages',
    text: '日常生活中最让你感到幸福的小事是：',
    dimension: 'language',
    options: [
      { value: 'service', label: '回家发现对方已经做好了晚饭' },
      { value: 'touch', label: '出门前对方的一个亲吻' },
      { value: 'time', label: '每天睡前的聊天时光' },
    ],
  },
  {
    testSlug: 'love-languages',
    text: '你吵架后最希望对方怎么做？',
    dimension: 'language',
    options: [
      { value: 'words', label: '主动说对不起并表达真实感受' },
      { value: 'touch', label: '过来抱住你不说话' },
      { value: 'service', label: '默默为你泡一杯热茶或做点什么' },
    ],
  },

  // ============================================================
  // Attachment Style Questions (16)
  // ============================================================
  {
    testSlug: 'attachment-style',
    text: '在亲密关系中，你对伴侣的信任程度是：',
    dimension: 'style',
    options: [
      { value: 'secure', label: '我相信伴侣会在我需要时支持我' },
      { value: 'anxious', label: '我时常担心伴侣是否真的爱我' },
      { value: 'avoidant', label: '我不太愿意完全依赖任何人' },
      { value: 'disorganized', label: '我想要信任但又害怕受伤' },
    ],
  },
  {
    testSlug: 'attachment-style',
    text: '当伴侣没有及时回复你的消息时，你会：',
    dimension: 'style',
    options: [
      { value: 'secure', label: '觉得TA可能在忙，不太在意' },
      { value: 'anxious', label: '反复查看手机，开始胡思乱想' },
      { value: 'avoidant', label: '觉得这样也好，各自有空间' },
      { value: 'disorganized', label: '一会儿觉得没什么，一会儿又很焦虑' },
    ],
  },
  {
    testSlug: 'attachment-style',
    text: '关于亲密和独立，你的看法是：',
    dimension: 'style',
    options: [
      { value: 'secure', label: '我能自然地在亲密和独立之间切换' },
      { value: 'anxious', label: '我更渴望亲密，害怕独处' },
      { value: 'avoidant', label: '我更重视独立，太亲密让我不舒服' },
      { value: 'disorganized', label: '我在两者之间摇摆不定' },
    ],
  },
  {
    testSlug: 'attachment-style',
    text: '当你感到受伤时，你通常会：',
    dimension: 'style',
    options: [
      { value: 'secure', label: '向伴侣坦诚表达自己的感受' },
      { value: 'anxious', label: '通过各种方式寻求伴侣的关注' },
      { value: 'avoidant', label: '独自处理情绪，不想让别人看到脆弱' },
      { value: 'disorganized', label: '想要倾诉但又不知道如何表达' },
    ],
  },
  {
    testSlug: 'attachment-style',
    text: '你对关系中冲突的处理方式是：',
    dimension: 'style',
    options: [
      { value: 'secure', label: '平静地讨论问题，寻找解决方案' },
      { value: 'anxious', label: '害怕冲突会导致分手，变得紧张' },
      { value: 'avoidant', label: '倾向于回避冲突或冷处理' },
      { value: 'disorganized', label: '情绪反应强烈，可能爆发也可能逃避' },
    ],
  },
  {
    testSlug: 'attachment-style',
    text: '你在关系初期通常的表现是：',
    dimension: 'style',
    options: [
      { value: 'secure', label: '自然地发展关系，不会过度焦虑' },
      { value: 'anxious', label: '很快投入，希望尽快确定关系' },
      { value: 'avoidant', label: '保持距离，缓慢地开放自己' },
      { value: 'disorganized', label: '一开始很热情，但突然会想退缩' },
    ],
  },
  {
    testSlug: 'attachment-style',
    text: '当伴侣需要个人空间时，你会：',
    dimension: 'style',
    options: [
      { value: 'secure', label: '尊重并利用这段时间做自己的事' },
      { value: 'anxious', label: '感到不安，担心关系出了问题' },
      { value: 'avoidant', label: '觉得很好，自己也需要空间' },
      { value: 'disorganized', label: '理智上理解但情感上难以接受' },
    ],
  },
  {
    testSlug: 'attachment-style',
    text: '你对"依赖他人"这件事的感受是：',
    dimension: 'style',
    options: [
      { value: 'secure', label: '适度依赖是健康关系的一部分' },
      { value: 'anxious', label: '我很需要依赖亲密的人' },
      { value: 'avoidant', label: '我不喜欢依赖别人，这让我不自在' },
      { value: 'disorganized', label: '我想依赖但又害怕被抛弃' },
    ],
  },
  {
    testSlug: 'attachment-style',
    text: '关系中让你感到最安全的是：',
    dimension: 'style',
    options: [
      { value: 'secure', label: '彼此信任和坦诚的沟通' },
      { value: 'anxious', label: '伴侣频繁地表达爱和承诺' },
      { value: 'avoidant', label: '保有自己的空间和独立性' },
      { value: 'disorganized', label: '很难说清楚什么让我感到安全' },
    ],
  },
  {
    testSlug: 'attachment-style',
    text: '分手后你通常的状态是：',
    dimension: 'style',
    options: [
      { value: 'secure', label: '虽然难过但能够慢慢走出来' },
      { value: 'anxious', label: '非常痛苦，很难放下，反复回忆' },
      { value: 'avoidant', label: '看起来很快就没事了，压抑情绪' },
      { value: 'disorganized', label: '情绪非常混乱，又想联系又想远离' },
    ],
  },
  {
    testSlug: 'attachment-style',
    text: '你选择伴侣时最看重的特质是：',
    dimension: 'style',
    options: [
      { value: 'secure', label: '情感成熟、真诚可靠' },
      { value: 'anxious', label: '热情主动、经常表达爱意' },
      { value: 'avoidant', label: '独立自主、不太粘人' },
      { value: 'disorganized', label: '强烈的吸引力，但说不清为什么' },
    ],
  },
  {
    testSlug: 'attachment-style',
    text: '在感情中你最常有的担忧是：',
    dimension: 'style',
    options: [
      { value: 'secure', label: '我对关系的未来比较有信心' },
      { value: 'anxious', label: '担心对方不够爱我或会离开' },
      { value: 'avoidant', label: '担心失去自由和个人空间' },
      { value: 'disorganized', label: '既害怕被抛弃又害怕被吞噬' },
    ],
  },
  {
    testSlug: 'attachment-style',
    text: '你对表达感情的态度是：',
    dimension: 'style',
    options: [
      { value: 'secure', label: '能够自然地表达爱和脆弱' },
      { value: 'anxious', label: '非常渴望表达也需要对方回应' },
      { value: 'avoidant', label: '觉得不太需要频繁表达感情' },
      { value: 'disorganized', label: '想表达但又怕被拒绝' },
    ],
  },
  {
    testSlug: 'attachment-style',
    text: '当关系出现问题时，你会：',
    dimension: 'style',
    options: [
      { value: 'secure', label: '主动沟通，一起解决问题' },
      { value: 'anxious', label: '变得更加黏人，不停地确认关系' },
      { value: 'avoidant', label: '需要更多空间，可能会疏远' },
      { value: 'disorganized', label: '行为变得不可预测，又近又远' },
    ],
  },
  {
    testSlug: 'attachment-style',
    text: '你童年时与父母的关系大致是：',
    dimension: 'style',
    options: [
      { value: 'secure', label: '温暖稳定，感到被爱和支持' },
      { value: 'anxious', label: '父母的态度时好时坏，不太稳定' },
      { value: 'avoidant', label: '父母比较冷淡，学会了自己照顾自己' },
      { value: 'disorganized', label: '关系复杂，有时感到害怕或困惑' },
    ],
  },
  {
    testSlug: 'attachment-style',
    text: '你理想中的亲密关系是：',
    dimension: 'style',
    options: [
      { value: 'secure', label: '相互支持、信任、有安全感的关系' },
      { value: 'anxious', label: '热烈、充满激情、时刻感受到爱' },
      { value: 'avoidant', label: '尊重彼此空间、独立而不束缚' },
      { value: 'disorganized', label: '说不清楚，关系总是让我又爱又怕' },
    ],
  },

  // ============================================================
  // Mental Age Questions (15) - Likert scale 1-5
  // ============================================================
  {
    testSlug: 'mental-age',
    text: '面对新的流行趋势（如社交媒体、新技术），你的态度是：',
    dimension: 'mentalAge',
    options: [
      { value: '1', label: '非常不同意（我总是最先尝试）', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意（我觉得没必要跟风）', score: 5 },
    ],
  },
  {
    testSlug: 'mental-age',
    text: '我更喜欢在家安静地度过一个晚上，而不是出去社交',
    dimension: 'mentalAge',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'mental-age',
    text: '我已经对人生有了比较清晰的规划和方向',
    dimension: 'mentalAge',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'mental-age',
    text: '我能够理解和接受与自己不同的观点和生活方式',
    dimension: 'mentalAge',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'mental-age',
    text: '我认为健康和稳定比刺激和冒险更重要',
    dimension: 'mentalAge',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'mental-age',
    text: '遇到问题时，我倾向于冷静分析而不是冲动反应',
    dimension: 'mentalAge',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'mental-age',
    text: '我对物质享受的追求不如年轻时那么强烈了',
    dimension: 'mentalAge',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'mental-age',
    text: '我经常回忆过去的时光，觉得以前的日子更好',
    dimension: 'mentalAge',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'mental-age',
    text: '我已经学会了不再为别人的看法而改变自己',
    dimension: 'mentalAge',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'mental-age',
    text: '我觉得储蓄和理财比及时行乐更重要',
    dimension: 'mentalAge',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'mental-age',
    text: '我更看重一个人的内在品质而非外表',
    dimension: 'mentalAge',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'mental-age',
    text: '我已经接受了"生活不会总是公平的"这个事实',
    dimension: 'mentalAge',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'mental-age',
    text: '我对年轻人的一些行为感到不理解',
    dimension: 'mentalAge',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'mental-age',
    text: '我开始更加注重身体健康和生活品质',
    dimension: 'mentalAge',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'mental-age',
    text: '我认为人生最重要的是内心的平静和满足',
    dimension: 'mentalAge',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },

  // ============================================================
  // Human Feeling Questions (15) - Likert scale 1-5
  // ============================================================
  // Joy
  {
    testSlug: 'human-feeling',
    text: '我很容易因为小事感到开心和满足',
    dimension: 'joy',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'human-feeling',
    text: '我每天都能找到让自己微笑的理由',
    dimension: 'joy',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'human-feeling',
    text: '我对未来充满期待和希望',
    dimension: 'joy',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  // Empathy
  {
    testSlug: 'human-feeling',
    text: '看到别人哭泣时，我也会不由自主地感到难过',
    dimension: 'empathy',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'human-feeling',
    text: '我能很快察觉到周围人情绪的变化',
    dimension: 'empathy',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'human-feeling',
    text: '我经常设身处地地为他人着想',
    dimension: 'empathy',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  // Resilience
  {
    testSlug: 'human-feeling',
    text: '遇到挫折后，我能够比较快地恢复过来',
    dimension: 'resilience',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'human-feeling',
    text: '我相信困难只是暂时的，终会过去',
    dimension: 'resilience',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'human-feeling',
    text: '压力反而能激发我更好的表现',
    dimension: 'resilience',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  // Sensitivity
  {
    testSlug: 'human-feeling',
    text: '我对环境的变化（声音、光线、气味）特别敏感',
    dimension: 'sensitivity',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'human-feeling',
    text: '别人无意的一句话可能会让我想很久',
    dimension: 'sensitivity',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'human-feeling',
    text: '一部好的电影或小说能让我的情绪久久不能平复',
    dimension: 'sensitivity',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  // Passion
  {
    testSlug: 'human-feeling',
    text: '当我对一件事感兴趣时，会全身心地投入',
    dimension: 'passion',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'human-feeling',
    text: '我做事情总是充满热情和干劲',
    dimension: 'passion',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'human-feeling',
    text: '我的热情经常能感染身边的人',
    dimension: 'passion',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },

  // ============================================================
  // Dark Triad Questions (15) - Likert scale 1-5
  // ============================================================
  // Narcissism (N)
  {
    testSlug: 'dark-triad',
    text: '我认为自己比大多数人都优秀',
    dimension: 'N',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'dark-triad',
    text: '我喜欢成为别人关注的焦点',
    dimension: 'N',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'dark-triad',
    text: '我觉得自己应该得到特殊的对待',
    dimension: 'N',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'dark-triad',
    text: '别人的赞美和认可对我来说非常重要',
    dimension: 'N',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'dark-triad',
    text: '我很享受谈论自己的成就',
    dimension: 'N',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  // Machiavellianism (M)
  {
    testSlug: 'dark-triad',
    text: '为了达成目标，有时候需要隐瞒一些信息',
    dimension: 'M',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'dark-triad',
    text: '我善于利用社交关系来获得自己想要的东西',
    dimension: 'M',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'dark-triad',
    text: '结果比过程更重要，方法并不总是那么重要',
    dimension: 'M',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'dark-triad',
    text: '大多数人都容易被操纵',
    dimension: 'M',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'dark-triad',
    text: '在社交中我会战略性地展示自己的不同面',
    dimension: 'M',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  // Psychopathy (P)
  {
    testSlug: 'dark-triad',
    text: '我很少为自己的行为感到内疚',
    dimension: 'P',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'dark-triad',
    text: '我在危机情况下能保持异常冷静',
    dimension: 'P',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'dark-triad',
    text: '别人的痛苦不太容易影响到我的情绪',
    dimension: 'P',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'dark-triad',
    text: '我倾向于追求刺激，即使有一定风险',
    dimension: 'P',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
  {
    testSlug: 'dark-triad',
    text: '我做决定时很少考虑道德因素',
    dimension: 'P',
    options: [
      { value: '1', label: '非常不同意', score: 1 },
      { value: '2', label: '不同意', score: 2 },
      { value: '3', label: '中立', score: 3 },
      { value: '4', label: '同意', score: 4 },
      { value: '5', label: '非常同意', score: 5 },
    ],
  },
];

// ============================================================
// System Config Seeds
// ============================================================

const systemConfigSeeds = [
  {
    key: 'llm.base_url',
    value: 'https://api.deepseek.com/v1',
    description: 'LLM API 基础地址',
  },
  {
    key: 'llm.api_key',
    value: '',
    description: 'LLM API 密钥（需在管理后台配置）',
  },
  {
    key: 'llm.model',
    value: 'deepseek-chat',
    description: 'LLM 模型名称',
  },
  {
    key: 'llm.temperature',
    value: 0.7,
    description: 'LLM 生成温度参数',
  },
  {
    key: 'llm.max_tokens',
    value: 4000,
    description: 'LLM 最大生成 token 数',
  },
  {
    key: 'report.system_prompt',
    value: `你是一位专业、温暖且富有洞察力的心理咨询顾问。你的任务是基于用户的心理测试结果，生成一份深入、个性化的分析报告。

请遵循以下原则：
1. **专业性**：基于心理学理论和研究，给出有深度的分析
2. **温暖感**：用温和、鼓励的语气，让用户感到被理解和支持
3. **个性化**：根据具体的测试结果和维度得分，给出针对性的分析，避免泛泛而谈
4. **实用性**：提供具体可行的建议和成长方向
5. **平衡性**：既肯定优势，也温和地指出可能的成长空间

报告结构应包含：
- 整体概述（2-3句话概括核心人格特质）
- 各维度详细分析（结合得分高低进行解读）
- 优势与潜力（基于测试结果分析个人优势）
- 成长建议（具体、可操作的改善建议）
- 人际关系洞察（在关系中的特点和建议）
- 职业发展参考（与职业选择相关的建议）

请使用中文撰写报告，语言要自然流畅，避免生硬的翻译腔。`,
    description: 'AI 报告生成系统提示词',
  },
  {
    key: 'report.price',
    value: 9.9,
    description: 'AI 报告默认价格（元）',
  },
];

// ============================================================
// Seed Functions
// ============================================================

async function seedTestTypes() {
  console.log('  Seeding test types...');

  for (const seed of testTypeSeeds) {
    await db
      .insert(testTypes)
      .values({
        id: seed.id,
        name: seed.name,
        slug: seed.slug,
        description: seed.description,
        shortDescription: seed.shortDescription,
        scoringStrategy: seed.scoringStrategy,
        scoringConfig: seed.scoringConfig,
        resultDefinitions: seed.resultDefinitions,
        questionCount: seed.questionCount,
        estimatedMinutes: seed.estimatedMinutes,
        isFeatured: seed.isFeatured,
        sortOrder: seed.sortOrder,
        reportPrice: seed.reportPrice,
      })
      .onConflictDoUpdate({
        target: testTypes.slug,
        set: {
          name: seed.name,
          description: seed.description,
          shortDescription: seed.shortDescription,
          scoringStrategy: seed.scoringStrategy,
          scoringConfig: seed.scoringConfig,
          resultDefinitions: seed.resultDefinitions,
          questionCount: seed.questionCount,
          estimatedMinutes: seed.estimatedMinutes,
          isFeatured: seed.isFeatured,
          sortOrder: seed.sortOrder,
          reportPrice: seed.reportPrice,
        },
      });
  }

  console.log(`  ✓ Seeded ${testTypeSeeds.length} test types`);
}

async function seedQuestions() {
  console.log('  Seeding questions...');

  // Build a slug->id map from the database (in case of re-runs)
  const allTypes = await db.select().from(testTypes);
  const slugToId = new Map(allTypes.map((t) => [t.slug, t.id]));

  // Delete existing preset questions for a clean re-seed
  await db.delete(questions).where(sql`${questions.source} = 'preset'`);

  let totalQuestions = 0;

  for (const seed of questionSeeds) {
    const testTypeId = slugToId.get(seed.testSlug);
    if (!testTypeId) {
      console.warn(`  ⚠ Test type not found for slug: ${seed.testSlug}`);
      continue;
    }

    // Find sortOrder for this test type
    const existingCount = questionSeeds
      .slice(0, questionSeeds.indexOf(seed))
      .filter((q) => q.testSlug === seed.testSlug).length;

    await db.insert(questions).values({
      id: nanoid(),
      testTypeId,
      text: seed.text,
      options: seed.options,
      dimension: seed.dimension,
      weight: '1.00',
      source: 'preset',
      sortOrder: existingCount + 1,
      isActive: true,
    });

    totalQuestions++;
  }

  console.log(`  ✓ Seeded ${totalQuestions} questions`);
}

async function seedSystemConfig() {
  console.log('  Seeding system config...');

  for (const seed of systemConfigSeeds) {
    await db
      .insert(systemConfig)
      .values({
        key: seed.key,
        value: seed.value,
        description: seed.description,
      })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: {
          value: seed.value,
          description: seed.description,
        },
      });
  }

  console.log(`  ✓ Seeded ${systemConfigSeeds.length} system config entries`);
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('[seed] Seeding test data...');
  await seedTestTypes();
  await seedQuestions();
  await seedSystemConfig();
  console.log('[seed] Seed complete!');
  await conn.end();
  process.exit(0);
}

main().catch((e) => {
  console.error('[seed] Seed failed:', e);
  process.exit(1);
});
