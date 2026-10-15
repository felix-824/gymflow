import { Schema } from 'mongoose';

const ReviewSchema = new Schema(
	{
		rating: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
		content: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
		memberId: { type: Schema.Types.ObjectId, required: true, ref: 'Member' },
		trainerId: { type: Schema.Types.ObjectId, required: true, ref: 'Member' },
		programId: { type: Schema.Types.ObjectId, required: true, ref: 'Program' },
		reservationId: { type: Schema.Types.ObjectId, required: true, ref: 'Reservation' },
	},
	{ timestamps: true, collection: 'reviews' },
);
ReviewSchema.index({ reservationId: 1 }, { unique: true });
ReviewSchema.index({ programId: 1, createdAt: -1, _id: -1 });
export default ReviewSchema;
