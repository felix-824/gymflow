import { Types } from 'mongoose';

export interface ProgramCreateRequest {
	memberId: Types.ObjectId;
	createRequestId: string;
	payloadHash: string;
	programId: Types.ObjectId;
	createdAt: Date;
}
