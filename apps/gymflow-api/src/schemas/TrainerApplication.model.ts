import { Schema } from 'mongoose';
import { ProgramCategory } from '../libs/enums/program.enum';
import { TrainerApplicationStatus } from '../libs/enums/trainer-application.enum';

const TrainerApplicationSchema = new Schema(
	{
		memberId: { type: Schema.Types.ObjectId, required: true, ref: 'Member', immutable: true },
		status: { type: String, enum: TrainerApplicationStatus, required: true, default: TrainerApplicationStatus.PENDING },
		fullName: { type: String, required: true, trim: true, minlength: 3, maxlength: 100 },
		categories: {
			type: [{ type: String, enum: ProgramCategory }],
			required: true,
			default: undefined,
			validate: {
				validator: (values: ProgramCategory[]) =>
					Array.isArray(values) &&
					values.length > 0 &&
					values.length <= Object.values(ProgramCategory).length &&
					new Set(values).size === values.length,
				message: 'Provide unique valid program categories',
			},
		},
		experienceSummary: { type: String, required: true, trim: true, maxlength: 1000 },
		bio: { type: String, required: true, trim: true, maxlength: 2000 },
		rejectionReason: { type: String, maxlength: 1000, default: null },
		reviewedBy: { type: Schema.Types.ObjectId, ref: 'Member', default: null },
		reviewedAt: { type: Date, default: null },
	},
	{ timestamps: true, collection: 'trainerApplications' },
);
TrainerApplicationSchema.index(
	{ memberId: 1 },
	{
		unique: true,
		partialFilterExpression: { status: { $in: [TrainerApplicationStatus.PENDING, TrainerApplicationStatus.APPROVED] } },
	},
);
TrainerApplicationSchema.index({ memberId: 1, createdAt: -1, _id: -1 });
export default TrainerApplicationSchema;
