import { Schema } from 'mongoose';

const ProgramCreateRequestSchema = new Schema(
	{
		memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, immutable: true },
		createRequestId: { type: String, required: true, immutable: true },
		payloadHash: { type: String, required: true, immutable: true },
		programId: { type: Schema.Types.ObjectId, ref: 'Program', required: true, immutable: true },
	},
	{ timestamps: { createdAt: true, updatedAt: false }, collection: 'programCreateRequests' },
);
ProgramCreateRequestSchema.index({ memberId: 1, createRequestId: 1 }, { unique: true });
export default ProgramCreateRequestSchema;
