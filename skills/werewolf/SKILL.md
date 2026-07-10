---
name: werewolf
description: "Use when an Agent needs to host or play a werewolf game (狼人杀) — a hidden-role social-deduction game — over the `agent-chat` CLI: assigning secret roles, running night actions (wolf-team kill, 预言家/seer check, 女巫/witch save & poison, 猎人/hunter death-shot), day discussion and simultaneous voting, eliminations, and judging 屠边 win conditions. Trigger when the task involves 狼人杀 or 狼人/预言家/女巫/猎人/平民, moderating (上帝/法官) or playing a hidden-role social-deduction game among agents, or orchestrating game cycles over agent-chat scoped rounds, whispers, and ballots."
---

# 狼人杀(主持人 + 玩家)over `agent-chat`

`agent-chat` 的 scoped round、`whisper`、`poll`/`vote`/`reveal`、`eliminate` 正好映射到狼人杀的全部机制。本文把一个 agent 同时教会**当主持人(上帝/法官)**和**当玩家**:发身份、跑夜晚行动(狼队杀人、预言家查验、女巫救毒、猎人开枪)、白天讨论与同时投票、处决、以及屠边胜负判定。

整个游戏仍是 `agent-chat` 的唯一节奏:**`wait` → 读指令 → 执行 → `wait`**。区别只在主持人要在自己上下文里维护一份"游戏账本"。

> 前置依赖:先读 *agent-chat* skill。本文只讲狼人杀特有的映射,不复述通用协议(raise/send/wait 的基础用法见那里)。

## 角色与配置(默认 9 人局)

| 角色 | 人数 | 能力 |
|---|---|---|
| 狼人 | 3 | 每晚狼队共同商议杀一人;狼人互相知道身份 |
| 预言家 | 1 | 每晚查验一人身份,主持人私下回报"狼/好人" |
| 女巫 | 1 | 一瓶解药(救当晚被杀者)+ 一瓶毒药(毒杀任意一人),各只能用一次 |
| 猎人 | 1 | 被狼杀或被公投出局时可开枪带走一人(被女巫毒杀**不能**开枪) |
| 平民 | 3 | 无夜晚行动,白天讨论与投票 |

9 人 = 3 狼 + 3 神(预言家/女巫/猎人)+ 3 平民。这张角色表是唯一需要改的地方——换表就换局,游戏循环不变。

### 换局(例如 12 人、加守卫)

只改两处:(1) 玩家数;(2) 夜晚行动步骤清单。例如 12 人 = 4 狼 + 预言家 + 女巫 + 猎人 + 守卫 + 4 平民:守卫每晚用一个 scoped round(`collect --participants <守卫>`)报一个保护目标,被保护者当夜免于狼刀;在夜晚步骤里插入"守卫"这一步即可。胜负判定与白天流程完全不变。

## 胜负判定(屠边)

- *狼人胜* = 所有神职(预言家/女巫/猎人)死亡 **或** 所有平民死亡。
- *好人胜* = 所有狼人死亡。

**铁律:每次有人死亡后,主持人必须立刻判一次胜负。** 死亡来源包括:夜晚被狼杀、被女巫毒、白天被公投、被猎人开枪带走。判定完全依赖下面的账本。

## 主持人状态账本

`agent-chat` 不存游戏状态,只存消息。**主持人必须在自己上下文里维护这份账本**,每次死亡、每次药剂使用、每次查验后都更新。胜负判定完全靠它。

可复制粘贴的模板(开局发完身份后填好 `角色`/`狼队`):

```
回合: 1
存活: [alice, bob, carol, dave, erin, frank, gina, heidi, ivan]
角色: { alice:狼人, bob:狼人, carol:狼人, dave:预言家, erin:女巫, frank:猎人, gina:平民, heidi:平民, ivan:平民 }
狼队: [alice, bob, carol]                       # 仅主持人知道
女巫药剂: { 解药: 未用, 毒药: 未用 }
预言家存活: 是
待结算死亡: []                                  # 当夜被杀/被毒的人,清晨公布时结算
猎人死因: -                                     # 猎人若被毒则不能开枪,记这里
```

维护纪律:每次 `eliminate` 后从 `存活` 删名;每次药剂使用后翻转 `未用→已用`;每次查验后(主持人侧)记下"X 查 Y = 狼/好人";每夜结束时把 `待结算死亡` 填好(女巫救了就从列表移除被救者,女巫毒了就加上被毒者)。

## 原语映射:狼人杀概念 → `agent-chat` 命令

这是正确性的核心,务必照此表。

| 狼人杀概念 | 用什么 `agent-chat` 原语 | 为什么 |
|---|---|---|
| 主持人公开宣布(开场/公布昨夜死亡) | `send`(房间 idle 时,主持人可自由发言) | 公开广播给所有人 |
| 主持人单向私密通知(发身份) | `whisper --to <names...> --content <text>` | host→agent 单向,免仪式,非收件人不可见 |
| 狼队夜晚商议杀谁 | scoped round `collect --participants <狼队>`,狼人轮流发言,主持人旁听 | 多人私密讨论;主持人凭特权可见 |
| 预言家查验(双向私密 Q&A) | scoped round `collect --participants [预言家]`,`order --order 预言家 主持人`:预言家报目标 → 主持人回报结果 | `whisper` 是单向,agent 无法私密回复,必须用 scoped round |
| 女巫救/毒(双向,主持人先给信息) | scoped round `collect --participants [女巫]`,`order --order 主持人 女巫 主持人` | 同上,且主持人需先把"谁被杀"告诉女巫 |
| 猎人开枪(死亡触发,双向) | scoped round `collect --participants [猎人]`,`order --order 主持人 猎人` | 死亡时触发;猎人未 `eliminate` 前才能 raise/send |
| 白天讨论 | public round `collect`(全体存活) | 公开轮流发言 |
| 白天投票(同时亮票) | `poll --question ... --participants <存活>` → 各人 `vote --ballot <目标>` → 主持人 `reveal` | `reveal` 一次性公开所有票,投票期间无人能看到早投的票 |
| 处决(票王/被毒/被杀) | `eliminate --name <agent>` | 永久移出后续轮次,但仍在线观战 |
| 等待事件 | `wait` | 永远 `wait`→act→`wait` |

### 两条铁律

1. **`reveal` 是公开的。** 狼队商议杀谁**绝不能**用 `poll`/`reveal`——`reveal` 会把每张票作为一条公开消息发出去,直接暴露所有狼人。狼队私密决策只能用 **scoped round 讨论**,由主持人读 `history` 记录共识。
2. **`whisper` 是单向(host→agent)。** 任何需要 agent 私密**回复**的环节(预言家查验、女巫救毒、猎人开枪)都必须用 **scoped round**,不能 `whisper` 一问了之——agent 没有任何私密回信通道能接住 `whisper`,只有 scoped round 里 agent 才能 `send` 回话。

## 游戏循环(主持人视角,含精确命令)

下例以 **host 名 = `mod`**,玩家 alice..ivan 为例,其中 alice/bob/carol=狼、dave=预言家、erin=女巫、frank=猎人、gina/heidi/ivan=平民。脚本里 `$H` 是主持人的 session。

### 开局:开房 → 收人 → 发身份

```bash
# 1. 主持人开房
agent-chat serve --room village --name mod
# → Room 'village' started on port 54321 (detached)
# → File: ./village.54321.json
# → Host session: s_54321_a1b2...
H=s_54321_a1b2...   # 记下主持人 session(serve --name 给的是 `mod`,后续 order 里就用 `mod`)

# 2. 收人:反复 wait,直到 9 人 join(presence 事件)
agent-chat wait --session $H   # → + alice joined
agent-chat wait --session $H   # → + bob joined
# ... 直到 alice..ivan 全部加入

# 3. 发身份(房间 idle,直接 whisper)
# 3a. 给每个非狼玩家单独发
agent-chat whisper --session $H --to dave  --content "你的角色是预言家。每晚可查验一人身份,我会私下告诉你他是狼/好人。"
agent-chat whisper --session $H --to erin  --content "你的角色是女巫。一瓶解药(救当晚被杀者)+ 一瓶毒药(毒杀一人),各只能用一次。"
agent-chat whisper --session $H --to frank --content "你的角色是猎人。被狼杀或被公投出局时可开枪带走一人(被毒杀不能开枪)。"
agent-chat whisper --session $H --to gina  --content "你的角色是平民。无夜晚行动,白天讨论与投票。"
agent-chat whisper --session $H --to heidi --content "你的角色是平民。"
agent-chat whisper --session $H --to ivan  --content "你的角色是平民。"

# 3b. 给狼队一条 group whisper(队友彼此可见)
agent-chat whisper --session $H --to alice bob carol --content "你们是狼人。队友:alice、bob、carol。每晚共同商议杀一人。"
```

> `whisper --to` 可一次写多个名字(group);收件人之间互相可见该消息,非收件人什么都看不到。

### 夜晚(主持人按序逐个跑 scoped round)

每个 scoped round 都 `--participants` 限定到本人;**不要把主持人写进 `--participants`**(系统会报错 "Host is implicitly in scope")。主持人在 round 内发言靠把自己(真名 `mod`)写进 `--order`。夜晚行动是强制的:行动者要 `raise --weight` **大于 0**(用 0 跳过会让该轮空转、卡住游戏)。

> ⚠ **重要:`agent-chat` 目前没有中止/超时一个 collect 或 poll 的命令。** 一旦开了一个 scoped round 或投票,**所有参与者必须完成各自的 `raise`(投票则是 `vote`)**,否则 `all_decided` / `all_voted` 永不触发、`wait` 永久阻塞,游戏卡死且无法回退。因此:① 开局前确认所有玩家都是会自动 `wait`→`raise` 的 agent;② `--participants` 只写该行动必需的人(范围越小,卡死面越小);③ 单个 scoped round 内人越少越稳。

**① 狼队商议(scoped,仅狼人;主持人旁听,不在 order 内)**

```bash
agent-chat collect --session $H --participants alice bob carol
agent-chat wait --session $H                          # → all_decided(三狼都已 raise)
agent-chat order --session $H --order alice bob carol # 主持人不在 order,只旁听
# 三狼各自 wait→send 商议杀谁
agent-chat wait --session $H                          # → round_done
agent-chat history --session $H --unread-only         # 读狼队共识,记入账本:当夜被杀 = <共识目标>
```

> 狼队没达成共识怎么办?一轮发言不够时,主持人可**再开一个** scoped round(`collect --participants <狼队>` → …)让他们继续商量;仍不一致则由**主持人裁定**(取多数,或要求狼队给出最终一人)。绝不要为此改用 `poll`/`reveal`(会暴露狼人)。

**② 预言家(若存活;双向 scoped round)**

```bash
agent-chat collect --session $H --participants dave
agent-chat wait --session $H                  # → all_decided(dave 已 raise)
agent-chat order --session $H --order dave mod   # dave 先报目标,主持人后回报
agent-chat wait --session $H                  # → your_turn(轮到 mod:dave 已发完)
agent-chat history --session $H --unread-only # 读到 dave: "查 alice"
# 主持人按账本判定 alice 是狼/好人,回报(此消息仅 dave 可见):
agent-chat send --session $H --content "alice 是狼人"
agent-chat wait --session $H                  # → round_done
# 账本记:dave 查 alice = 狼
```

**③ 女巫(若存活;双向,主持人先给信息)**

> **女巫默认规则**(赛前可改):① **同夜可既救又毒**(解药、毒药互不干扰,各一剂,用完即止);② **解药不可救自己**;③ 主持人只告诉女巫"谁被杀"的**名字,不给身份**;④ 被救者当夜免于狼刀;⑤ 女巫也可不动(不救不毒)。

`order --order mod erin mod` 让主持人说两段(给信息 → 女巫答 → 主持人确认);`mod` 出现两次是合法的(系统按顺序逐个发言,不去重)。

```bash
agent-chat collect --session $H --participants erin
agent-chat wait --session $H                       # → all_decided
agent-chat order --session $H --order mod erin mod # 主持人→女巫→主持人
agent-chat wait --session $H                       # → your_turn(mod 第 1 段)
agent-chat send --session $H --content "昨夜 alice 被杀。解药:有,毒药:有。你要救/毒谁/不动?"
agent-chat wait --session $H                       # → your_turn(mod 第 2 段;erin 已回复)
agent-chat history --session $H --unread-only      # 读 erin: "救" / "毒 bob" / "不动"
# 按回复更新账本(解药/毒药翻转、待结算死亡增删),再确认:
agent-chat send --session $H --content "已记录。"
agent-chat wait --session $H                       # → round_done
```

夜晚结束后,主持人汇总 `待结算死亡` = 被狼杀者(除非女巫救)+ 被女巫毒者。

### 白天(结算 → 讨论 → 投票 → 处决 → 判胜负)

> 默认**每天都有白天讨论 + 投票**(含第一夜之后的首日)。常见变体"首日免投"(第一天只讨论不投票、直接入夜)需在赛前约定并记入账本。

**① 结算夜晚死亡**

```bash
# 房间 idle,主持人公开宣布(自由发言)
agent-chat send --session $H --content "天亮了。昨夜:alice 死亡。"
# 对每个死者:**若是猎人且未被毒,先跑猎人开枪 scoped round(见 ②),再 eliminate 该猎人;否则直接 eliminate。**
agent-chat eliminate --session $H --name alice      # alice 非猎人,直接结算
# 账本:存活移除 alice;立刻判胜负(屠边)
```

> **平安夜**:若 `待结算死亡` 为空(女巫救了、或狼队弃刀),主持人公开宣布"昨夜平安夜,无人死亡",无需 `eliminate`,直接进白天讨论。判胜负时存活未变,通常未结束。

**② 猎人开枪(仅当死者是猎人、且不是被毒)**

猎人必须**在 `eliminate` 之前**开 scoped round——`eliminate` 后猎人不能再 raise/send。所以处理夜晚死者或票王时,**先**判断是不是(未毒)猎人,是则先跑这一段。流程:开枪轮拿到目标 → `eliminate` 目标 → `eliminate` 猎人。

```bash
# 假设 frank(猎人)被狼杀且未被毒,frank 此时仍存活
agent-chat collect --session $H --participants frank
agent-chat wait --session $H                       # → all_decided
agent-chat order --session $H --order mod frank
agent-chat wait --session $H                       # → your_turn(mod)
agent-chat send --session $H --content "你已死亡,是否开枪带走一人?报名字或'不开枪'。"
agent-chat wait --session $H                       # → round_done(frank 已答完)
agent-chat history --session $H --unread-only      # 读 frank: "枪打 bob"
agent-chat eliminate --session $H --name bob       # 带走目标(若 frank 说"不开枪"则跳过)
agent-chat eliminate --session $H --name frank     # 猎人本身结算
# ⚠ 每次死亡后都要立刻判胜负(屠边):bob 出局后判一次,frank 出局后再判一次
```

> 若猎人被女巫毒死,跳过本步——毒死的猎人不能开枪,直接 `eliminate frank`。

> **链式开枪**:若猎人开枪带走的目标**也是(未毒)猎人**,该目标在被 `eliminate` 前同样触发一轮开枪(按 ② 递归处理,直到没有新猎人开枪为止)。默认 9 人局只有一个猎人,不会触发;换局引入多猎人时务必按此递归。

**③ 判胜负**。已分胜负 → 跳到 *结束*;否则继续。

**④ 白天讨论(public round,全体存活)**

```bash
agent-chat collect --session $H                    # 无 --participants = 全体公开轮
agent-chat wait --session $H                       # → all_decided(存活者都已 raise)
# 按 all_decided 事件给出的权重降序排发言(权重高先说)
agent-chat order --session $H --order <按权重降序、且 raise 过的存活者>
# 各人依次 wait→send 发言(可用 --mention 指名对话);主持人 wait→round_done
agent-chat wait --session $H                       # → round_done
```

> `all_decided` 的 weights **只包含 raise 过的人**。没举手(或 `raise --weight 0`)的存活者不在列表里、本轮不发言——`order` 时直接略过他们。这是正常行为,不是 bug。

**⑤ 投票(同时亮票)**

```bash
agent-chat poll --session $H --question "投谁出局?" --participants <所有存活者>
# 每个存活者 wait→vote_open→ vote --ballot <名字>(票在 reveal 前对所有人保密)
agent-chat wait --session $H                       # → all_voted
agent-chat reveal --session $H                     # 一次性公开全部票(成为一条公开消息)
agent-chat history --session $H --unread-only      # 读票数,找出票王
```

**⑥ 处决票王**

```bash
# 先看票王身份:
#   - 票王是猎人(投票出局不会中毒,故一定可开枪)→ 先跑猎人开枪 scoped round(见 ②),再 eliminate 票王
#   - 否则 → 直接 eliminate
agent-chat eliminate --session $H --name <票王>
# ⚠ 立刻判胜负(屠边);若票王是猎人,其开枪带走的目标出局后也要再判一次
```

> **平票(无票王)默认规则**:本轮无人出局,主持人公开宣布"平票,无人出局",直接进入下一夜(等价于平安日)。若想用别的规则(重投、随机),在赛前约定并在账本里记下。

未分胜负 → 进入下一夜(回到 *夜晚 ①*)。

### 结束

```bash
agent-chat send --session $H --content "游戏结束,狼人胜/好人胜。"  # 公开结果
agent-chat kill --session $H                                      # 关闭房间;所有玩家会收到 killed 事件
```

## 玩家侧行动要点

玩家 agent 收到的事件与应对:

| 你收到 | 含义 | 你要做 |
|---|---|---|
| (游戏开始前) | 主持人已开房 | `agent-chat join --file <房间文件>.<端口>.json --name <你的名字>`(文件名即主持 `serve` 打印的 `File:` 那行)拿 session;然后 `wait` 等身份 |
| `whisper`(身份) | 主持人私下告诉你角色 | `history --unread-only` 读身份,记在心里;**绝不在公开轮 `send` 出真实身份**(除非战术上跳身份) |
| `collect`(显示 *Private round with: …*) | 你被拉进一个私密轮(夜晚行动) | `raise`(权重大于 0)→ 等 `your_turn` → `send`。狼人轮里和队友商量目标;预言家轮里报查验目标;女巫轮里报救/毒/不动 |
| `your_turn`(私密轮内) | 轮到你私密发言 | `history --unread-only` 先看上文 → `send` 回话(`send` 即结束本回合,一次说清) |
| `collect`(公开轮,无 Private 提示) | 白天讨论 | `raise` → 等 `your_turn` → `send` 发表分析/跳身份/带节奏(可 `--mention`) |
| `vote_open` | 白天投票开了 | `vote --ballot <名字>` 投你想出局的人(票在 `reveal` 前对所有人保密) |
| `collect`(*你是猎人*,被宣布死亡后收到) | 你的临终开枪轮——你此刻**仍存活**(被 `eliminate` 前才能开枪) | `raise` → 等 `your_turn` → `send` 报出要带走的名字(或"不开枪")。**不要错过**,这是你最后的行动 |

要点:
- *狼人*:夜晚 scoped round 里配合队友统一刀法;白天装好人,可悍跳神职或倒钩,但不要在公开轮暴露队友。
- *神职(预言家/女巫/猎人)*:保守秘密。预言家可白天公开查验结果"跳预言家",但要权衡;女巫的药剂动向只在女巫私密轮里说。
- *平民*:白天发言找狼,投票。
- 所有角色:`wait` 是唯一入口,不要轮询;发言前先 `history --unread-only`。

## 常见错误

- **用 `poll`/`reveal` 给狼队投票决定杀谁。** `reveal` 是公开的,会一次性把所有狼人的选票公之于众。狼队决策只能用 scoped round。
- **用 `whisper` 去"收集"agent 的回复。** `whisper` 是 host→agent 单向;agent 无法私密回信。预言家/女巫/猎人都要 agent 回话,必须开 scoped round。
- **忘记更新账本。** 药剂、存活、查验结果不更新,胜负判定就会错。每次死亡/用药/查验后立刻改。
- **`reveal` 后忘记 `eliminate`。** 票王必须 `eliminate` 才真正出局;`reveal` 只公布票数。
- **没在每次死亡后判胜负。** 夜杀、毒杀、公投、猎人开枪——任一死亡后都要判一次屠边,否则可能漏判结束。
- **`order` 里用字面量 `host` 而非主持人真名。** 主持人要用 `serve --name` 给的真名(如 `mod`),系统不认识 `host` 这个字符串。
- **把主持人写进 `collect --participants`。** 主持人隐式在 scope 内,写进去会报错 "Host is implicitly in scope"。主持人在 round 内发言靠把自己写进 `--order`。
- **猎人已 `eliminate` 才想开枪。** 猎人 `eliminate` 后不能再 raise/send;开枪 scoped round 必须在 `eliminate` 猎人**之前**跑。
- **开两个轮次不 `wait`。** 一次只能有一个 collect 或一个 poll;必须等 `round_done`/`reveal` 回到 idle 再开下一个。
- **参与者不响应导致卡死(无解)。** `agent-chat` 没有 abort/超时;scoped round 里有人不 `raise`、或投票有人不 `vote`,`wait` 会永久阻塞且无法回退。开局前务必确保每个 `--participants` 都是会自动 `wait`→`raise` 的 agent,并把轮次范围压到最小。
