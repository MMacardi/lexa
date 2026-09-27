// Hand-checked readings for the HSK list, applied by scripts/build-hsk-lists.mjs
// over whatever reading it picks, and trusted by scripts/check-hsk-readings.ts.
//
// Each one was checked against the official HSK 3.0 list's own pinyin (as scraped
// from the HSK site by github.com/ivankra/hsk30, MIT) and 现代汉语词典. Written the
// way the rest of the list is: dictionary tones, no 一/不 sandhi, a neutral tone
// unmarked, one space per syllable and erhua as its own "r".

export const READINGS = {
  // pinyin-pro reads the character alone in another sense than the exam means:
  // 教 jiào "teaching" for jiāo "to teach" (HSK 1), 切 qiè for qiē "to cut".
  教: "jiāo",
  切: "qiē",
  夹: "jiā",
  觉: "jiào",
  供: "gōng",
  数: "shǔ",
  应: "yīng",
  钻: "zuān",
  铺: "pū",
  呛: "qiāng",
  勒: "lēi",
  率: "shuài",
  钉: "dìng",
  杆: "gǎn",
  奔: "bèn",
  挨: "ái",
  待: "dāi",
  咳: "ké",
  壳: "ké",
  血: "xiě",
  啦: "la",
  佛: "fó", // CC-CEDICT capitalises it (the Buddha), so the proper-noun filter skipped it
  为人: "wéi rén",
  定为: "dìng wéi",
  所长: "suǒ zhǎng",
  当天: "dàng tiān",
  当晚: "dàng wǎn",
  正当: "zhèng dàng",
  转动: "zhuǎn dòng",
  一晃: "yī huàng",
  琢磨: "zuó mo",
  泄露: "xiè lòu",
  下载: "xià zài",
  出血: "chū xiě",
  献血: "xiàn xiě",
  大都: "dà dū",
  盛: "chéng", // "to ladle out", in both lists; shèng is pinyin-pro's
  系领带: "jì lǐng dài",
  // The particles: HSK 2.0 has 地 de at level 3, 3.0 both de and dì at level 1;
  // 得 de is the level-2 reading both lists share (with dé in 3.0, děi in 2.0).
  地: "de",
  得: "de",

  // A particle or complement read with a full tone.
  看得见: "kàn de jiàn",
  懒得: "lǎn de",
  能不能: "néng bu néng",
  是不是: "shì bu shì",

  // Upstream typos: a wrong tone, a misplaced mark, a sandhi form in an unsandhied list.
  不一会儿: "bù yī huì r",
  奥运会: "Ào yùn huì",
  欧洲: "Ōu zhōu",
  嗯: "en", // as the HSK 2.0 list writes it; the first CC-CEDICT reading was ēn "a groan"
  一番: "yī fān",
  闺女: "guī nü",

  // Neutral tones the official list writes and upstream doesn't. Some change the
  // word: 东西 dōng xi is "thing", dōng xī "east and west"; 地方 dì fang "place",
  // dì fāng "local"; 大方 dà fang "generous", dà fāng "experts".
  一个劲儿: "yī ge jìn r", 一路上: "yī lù shang", 上个月: "shàng ge yuè", 上头: "shàng tou", 下个月: "xià ge yuè",
  世故: "shì gu", 东西: "dōng xi", 买卖: "mǎi mai", 事实上: "shì shí shang", 人家: "rén jia", 倒下: "dǎo xia",
  做生意: "zuò shēng yi", 停下: "tíng xia", 免不了: "miǎn bu liǎo", 公道: "gōng dao", 关上: "guān shang",
  出息: "chū xi", 剩下: "shèng xia", 动静: "dòng jing", 势头: "shì tou", 勤快: "qín kuai", 北边: "běi bian",
  发脾气: "fā pí qi", 受不了: "shòu bu liǎo", 口袋: "kǒu dai", 名气: "míng qi", 告诉: "gào su", 哇: "wa",
  固执: "gù zhi", 地方: "dì fang", 多少: "duō shao", 大体上: "dà tǐ shang", 大大咧咧: "dà da liē liē",
  大方: "dà fang", 大爷: "dà ye", 妻子: "qī zi", 媳妇: "xí fu", 学问: "xué wen", 家里: "jiā li", 小气: "xiǎo qi",
  岸上: "àn shang", 工夫: "gōng fu", 帮手: "bāng shou", 忘不了: "wàng bu liǎo", 怀里: "huái li", 恶心: "ě xin",
  手里: "shǒu li", 打交道: "dǎ jiāo dao", 把手: "bǎ shou", 挖苦: "wā ku", 摆设: "bǎi she", 放下: "fàng xia",
  故事: "gù shi", 早晨: "zǎo chen", 月饼: "yuè bing", 本事: "běn shi", 格式: "gé shi", 比不上: "bǐ bu shàng",
  比试: "bǐ shi", 灯笼: "dēng long", 熟悉: "shú xi", 状元: "zhuàng yuan", 玫瑰: "méi gui", 生意: "shēng yi",
  留下: "liú xia", 盘算: "pán suan", 瞧不起: "qiáo bu qǐ", 硬朗: "yìng lang", 碰上: "pèng shang",
  祖宗: "zǔ zong", 祸害: "huò hai", 红火: "hóng huo", 网上: "wǎng shang", 老人家: "lǎo ren jia", 老婆: "lǎo po",
  老字号: "lǎo zì hao", 老实说: "lǎo shi shuō", 能耐: "néng nai", 落下: "luò xia", 薪水: "xīn shui",
  行家: "háng jia", 西边: "xī bian", 见过: "jiàn guo", 试探: "shì tan", 说道: "shuō dao", 费用: "fèi yong",
  赶不上: "gǎn bu shàng", 跟上: "gēn shang", 踏上: "tà shang", 车上: "chē shang", 遇上: "yù shang",
  醒来: "xǐng lai", 门路: "mén lu", 阎王: "Yán wang", 队伍: "duì wu", 风筝: "fēng zheng",
};
