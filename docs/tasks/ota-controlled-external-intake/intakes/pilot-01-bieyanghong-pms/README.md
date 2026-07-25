# 喷水池态六酒店｜美团别样红系统｜PMS接入资料

资料包ID：`INTAKE-PILOT-01-BYH-PMS-001`
建立日期：2026-07-23
当前状态：`FIRST ADAPTER SELECTED / I0 PARTIAL / CONTROLLED LOGIN COMPLETE / POST-LOGIN OBSERVATION PARTIAL / COOKIE AUTOMATION BLOCKED / I1 VENDOR AUTHORIZATION REQUIRED / REAL CONNECTOR BLOCKED`

## 已确认

- 门店：喷水池态六酒店；
- 来源类别：PMS；
- 产品负责人确认系统名称：美团别样红系统；
- 产品负责人确认接口性质：需要网络登录后使用的PMS网页接口，不是厂商开放API；
- 产品负责人确认登录入口为`https://pms.meituan.com/`；
- 原`/hotelpms/api/v1/report/lion/manager/workbench/room`地址确认为登录后的业务接口；
- 产品负责人确认可提供专用最小权限测试子账号，并由门店授权人员在隔离浏览器中现场输入凭据；
- 产品负责人确认账号仅限喷水池态六酒店的受控只读自动化测试，禁止全部写操作；
- 用户提供候选地址：`https://pms.meituan.com/hotelpms/api/v1/report/lion/manager/workbench/room`；
- 地址可离线解析为HTTPS、主机`pms.meituan.com`、端口443、路径`/hotelpms/api/v1/report/lion/manager/workbench/room`；
- 地址不含URI user-info、查询参数、片段或可见凭据；
- 2026-07-25，门店授权人员在独立浏览器Profile中现场完成认证并选择“喷水池态六酒店”；
- PMS主页自然调用`POST /hotelpms/api/v1/report/home/workbench/room`，无请求体，HTTP状态200，响应为JSON包络；`data[]`每行当前观察到一个字符串字段和两个数字字段；
- 对原`GET /hotelpms/api/v1/report/lion/manager/workbench/room`做过一次受控只读探针，仅得到通用JSON包络，不能据此确认其业务方法、字段语义或连接器可用性；
- 已观察到PMS营业日、房型、主页经营概览等只读候选路径；尚未读取字段值或确认业务语义。
- 官方服务协议要求第三方技术对接先取得厂商许可，且禁止未经授权获取接口数据；当前Cookie自动抓取方案保持阻断；
- 官方公开签名式OpenAPI文档，包含营业日、房态/房型、可用房等只读能力；优先申请该正式接口的门店和方法权限，公开文档本身不等于已经开通。

## 尚未确认

- 正式厂商法律名称；
- 云端、本地或私有部署方式；
- 原`lion`候选地址的正确HTTP方法、非秘密参数、Content-Type、认证机制类型、权限范围和外部门店ID；
- OpenAPI正式开通证明，或厂商对网页登录会话自动化的书面许可；
- 允许频率、限流、分页、历史范围、增量水位、错误码和Schema变化规则；
- 响应字段及其是否覆盖PMS营业日、夜审、订单间夜、房费、钟点房、退款冲销、实体房型和可售库存；
- 资料责任人和门店业务复核人。

路径中的`/api/v1/`只作为地址路径片段记录，不能当作PMS产品版本，也不能证明这是厂商正式开放API。单一`room`地址不能证明完整“营业日＋订单间夜＋房费收入＋库存”能力。

## 当前安全边界

- 已在产品负责人和门店授权人员确认的范围内完成一次受控人工登录、门店选择和只读页面观察；
- 凭据只由授权人员在隔离浏览器现场输入；Codex未获取、接收、输出或保存密码、Cookie、Token或验证码；
- 仅留存接口路径、HTTP方法、状态码和匿名结构/类型指纹；原始请求/响应正文未写入聊天、Git、fixture或诊断文件；
- `pms.meituan.com:443`仍只对本次人工隔离浏览器观察开放；真实连接器egress仍未批准；
- 未启动Worker真实profile、`test/activate/run`、Secret解析、候选登记、周期抓取或企业微信发送；
- 字段名称、字段值和业务语义继续为`PENDING`，`message_enabled=false`。
- 厂商/合同自动化许可尚未登记；本次观察作为有限例外记录，不得继续扩大或重复，直至I1许可证据补齐；
- 不重新使用本次诊断保留的临时Chrome Profile，不导出、粘贴、保存或重放其中的Cookie或会话；
- 即使未来厂商书面批准网页登录自动化，也必须由独立浏览器会话代理持有会话；现有Connector Worker和后台配置不得接触Cookie本体。

## 下一份最小资料

请仅提供非秘密信息：

版本结论：

> `NO_VISIBLE_VERSION / OWNER_CONFIRMED_2026-07-24`

后续不得依赖产品版本字符串判断兼容性，必须以受信任构建产生的capability/schema指纹和实际脱敏合同测试识别变化。

受控人工登录和试点门店选择已完成。下一份最小资料改为：厂商OpenAPI正式开通证明，或明确批准“喷水池态六酒店＋指定路径/字段＋指定频率＋网页登录会话自动化”的书面文件。许可证据通过后，才继续主页房态字段、营业日、库存口径和错误码的受控验证。不要发送账号密码、Cookie、Token、验证码、API密钥或原始HAR文件。

脱敏响应样例必须先移除住客个人信息和全部凭据，只保留字段名及不具识别性的代表值，并登记实际文件SHA-256。

详细登记见[单一来源档案](./source-profile.md)。Cookie方案评估、授权清单和获批后的隔离架构见[Cookie/浏览器会话自动采集设计草案](./COOKIE-SESSION-AUTOMATION-DESIGN-DRAFT.md)。
