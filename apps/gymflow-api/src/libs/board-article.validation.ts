const spaceEntities = new Set([
	'nbsp',
	'NonBreakingSpace',
	'ensp',
	'emsp',
	'emsp13',
	'emsp14',
	'numsp',
	'puncsp',
	'thinsp',
	'ThinSpace',
	'VeryThinSpace',
	'hairsp',
	'MediumSpace',
	'ThickSpace',
	'NegativeVeryThinSpace',
	'NegativeThinSpace',
	'NegativeMediumSpace',
	'NegativeThickSpace',
	'ZeroWidthSpace',
	'zwnj',
	'zwj',
	'lrm',
	'rlm',
	'NoBreak',
	'ApplyFunction',
	'af',
	'InvisibleTimes',
	'it',
	'InvisibleComma',
	'ic',
	'Tab',
	'NewLine',
	'shy',
]);

// These checks validate text presence, not HTML safety or a new storage format.
export function isArticleTitle(value: unknown): boolean {
	if (typeof value !== 'string' || Array.from(value).length > 50) return false;
	const text = value.replace(/[\p{Default_Ignorable_Code_Point}\p{Cf}\p{Cc}]/gu, '').trim();
	return Array.from(text).length >= 3;
}

export function isArticleContent(value: unknown): boolean {
	if (typeof value !== 'string' || Array.from(value).length < 3 || Array.from(value).length > 5000) return false;
	const text = value
		.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
		.replace(/<(script|style|template|head|title|noscript)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
		.replace(/<\/?[a-z][a-z\d:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>|<![^>]*>/gi, ' ')
		.replace(
			/&(?:#([xX][\dA-Fa-f]+|\d+)|([a-zA-Z][a-zA-Z\d]+));?/g,
			(entity, code: string | undefined, name: string | undefined) => {
				if (name)
					return spaceEntities.has(name) && (entity.endsWith(';') || name === 'nbsp' || name === 'shy') ? ' ' : entity;
				if (!code) return entity;
				const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10);
				return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
			},
		)
		.replace(/[\s\p{Default_Ignorable_Code_Point}\p{Cf}\p{Cc}]/gu, '');
	return text.length > 0;
}
