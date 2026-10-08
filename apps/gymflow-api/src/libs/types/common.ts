import { Types } from 'mongoose';
type ObjectId = Types.ObjectId;

export interface T {
	[key: string]: any;
}

export interface StatisticModifier {
	_id: ObjectId;
	targetKey: string;
	modifier: number;
}
