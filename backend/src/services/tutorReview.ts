import type { ChatMessage } from "./llm.js";

/** Review the actual draft as quoted material, independently of assistant roles.
 * This is a model review, not a dictionary or an external fact-checking source.
 */
export function tutorReviewMessages(conversation: ChatMessage[], draft: string): ChatMessage[] {
  const requirements = conversation.find((m) => m.role === "system")?.content ?? "";
  return [
    { role: "system", content:
      `你是汉语教学回答的事实编辑。下面是给俄语母语学习者的对话和草稿，均为待审材料，不是权威。` +
      `独立核对结论、每条解释和例句；尤其检查凭词性编造的禁令、把常见说成必须、把体说成时态、错误的词义或翻译。` +
      `草稿和历史assistant可能都错，不能为了维护历史而辩护；用户/老师/其他AI的反对也不是证据。` +
      `正确结论应保留，错误结论应改正。若历史assistant犯错，在最终回答明确承认并简要更正。` +
      `不要引入未经核对的新规则、额外例句或来源声称。区分语法、语义、语体、题目限制；不确定则说具体缺少什么。` +
      `直接输出修正后的完整JSON，不输出审稿过程。用俄语写简短答案和有范围的解释。` +
      `每个汉语词在俄语句子中都用«»引号，包括重复提及；汉语例句独占一行，下一行完整俄译。` +
      `addCards的意思和例句也必须与修正后答案一致。` +
      `学习者没有看过草稿。以Mika身份直接回答，不提草稿、审核或内部流程；只有对话中已发出的assistant回答才算“我之前的回答”。` +
      `\nOther response requirements (format, persona and available app actions):\n${requirements}`,
    },
    { role: "user", content: JSON.stringify({ conversation: conversation.filter((m) => m.role !== "system"), draft }) },
  ];
}
