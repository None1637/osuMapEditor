// v346: 繁體中文键级覆盖表 (key → 繁體译文)
//  - 缺省路径: 对 zh-CN 译文做术语替换 (s2t.applyTwPhrases) + 逐字转换 (s2t.s2t);
//  - 仅当缺省转换结果不对/不地道时才在此加 key 级覆盖 (如台湾惯用语与字表转换冲突的词条)。
export const ZH_TW: Record<string, string> = {
};
