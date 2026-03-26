import { resolve } from 'node:path';
import swaggerJsdoc from 'swagger-jsdoc';

/**
 * swagger-jsdoc 自动扫描 @openapi 注释生成 OpenAPI spec。
 * 新增接口时只需在对应 route.ts 中添加 @openapi JSDoc 注释即可，无需手动维护。
 */
const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: '钉钉公共服务 API',
      description:
        '封装钉钉 LINK 网关接口，提供 RESTful API 供第三方 H5 页面和内部业务模块使用。',
      version: '1.0.0',
    },
    servers: [{ url: '/api/dingtalk', description: '当前环境' }],
  },
  // 扫描 dingtalk 目录下所有 route.ts 文件中的 @openapi 注释
  apis: [resolve(process.cwd(), 'src/app/api/dingtalk/**/route.ts')],
};

export const openapiSpec = swaggerJsdoc(options);
