import { Schema } from 'mongoose';

const AuthSessionSchema = new Schema(
	{
		memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, immutable: true, index: true },
		refreshDigest: { type: String, required: true },
		expiresAt: { type: Date, required: true, immutable: true },
		revokedAt: { type: Date, default: null },
		rotation: { type: Number, default: 0 },
	},
	{ timestamps: true, collection: 'authSessions' },
);
AuthSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export default AuthSessionSchema;
