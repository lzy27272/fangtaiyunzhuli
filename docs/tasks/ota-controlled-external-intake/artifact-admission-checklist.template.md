# 单一适配器制品准入检查表

> 本表只在I0至I4通过、单一适配器已完成离线实现后使用。通过本表不自动批准运行、联网或真实凭据解析。

## 1. 候选身份

| 字段 | 值 |
|---|---|
| 门店 | `PENDING` |
| 来源 | `PENDING` |
| 厂商/产品/版本 | `PENDING` |
| 适配器ID | `PENDING` |
| 适配器版本 | `PENDING` |
| 源码修订 | `PENDING` |
| capability fingerprint | `PENDING` |
| schema fingerprint | `PENDING` |
| artifact digest | `PENDING` |
| 构建流水线运行ID | `PENDING` |
| 当前状态 | `PENDING` |

以上值必须由同一个受信任构建产物生成，不接受浏览器、共享API或厂商响应自行声明。

## 2. 离线质量与供应链

- [ ] 代码评审通过；
- [ ] 单元、合同、脱敏fixture和金标准比较测试通过；
- [ ] 分页、增量水位、重放、错误码和Schema漂移测试通过；
- [ ] 房费精确到分、间夜及逐产品库存结果与人工金标准一致；
- [ ] 生成并归档SBOM；
- [ ] SAST、依赖和许可证扫描通过；
- [ ] 制品签名/摘要可独立复算；
- [ ] 镜像/制品不含Secret、原始导出或住客个人信息；
- [ ] 候选撤回、紧急停用和回退手册已评审。

## 3. 加载前准入与运行时证明

- [ ] 适配器在独立进程或容器运行；
- [ ] 在类加载、静态初始化和实例构造前完成候选准入；
- [ ] 运行时重新证明实际加载制品与批准的`artifact_digest`一致；
- [ ] 未把`collect`前preflight误当成Java执行沙箱；
- [ ] 默认拒绝网络策略已生效；
- [ ] 只为批准的连接器和目标地址开放最小egress；
- [ ] Secret只由外部SecretStore按最小权限读取；
- [ ] 运行身份与API、Migration、审计身份隔离。

## 4. 命令、幂等与审计

- [ ] 候选登记只允许migration/deployment owner执行；
- [ ] 批准、吊销、stage、promote和retire均有完整command receipt；
- [ ] `request_hash`由服务端对全部规范化请求字段重算；
- [ ] 重复命令有确定性幂等结果；
- [ ] 审计证据为追加式且可关联构建、批准人和运行身份。

## 5. 蓝绿与隔离UAT

- [ ] 新旧Worker使用独立LOGIN角色和独立凭据；
- [ ] 新凭据和新连接池先验证，再stage/promote；
- [ ] 旧凭据已撤销，旧连接池已关闭；
- [ ] 独立运维身份终止旧backend；
- [ ] `pg_stat_activity`确认旧角色会话为0；
- [ ] 等待切换前租约完成或过期后再retire；
- [ ] 真实并发写冲突事务回滚并由新ACTIVE身份安全重放；
- [ ] 真实15分钟墙钟长测通过；
- [ ] 影子采集期间`message_enabled=false`且未向正式群发送。

## 6. 复核结论

| 角色 | 姓名/账号别名 | 结论 | 日期 | 备注 |
|---|---|---|---|---|
| 适配器负责人 | `PENDING` | `PENDING` | `PENDING` | |
| 安全复核人 | `PENDING` | `PENDING` | `PENDING` | |
| Migration/Deployment Owner | `PENDING` | `PENDING` | `PENDING` | |
| 门店业务复核人 | `PENDING` | `PENDING` | `PENDING` | |

允许的最终结论只有：

- `REJECTED`
- `REWORK_REQUIRED`
- `OFFLINE_ARTIFACT_READY`
- `ELIGIBLE_FOR_SEPARATE_CANDIDATE_REGISTRATION_REVIEW`

不得在本表中写成`PRODUCTION APPROVED`。
