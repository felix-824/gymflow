import { Schema } from 'mongoose';
import { ProgramCategory, ProgramLocation, ProgramStatus, ProgramType } from '../libs/enums/program.enum';
import { assertProgram } from '../libs/program.validation';

const integer = (min: number) => ({
	type: Number,
	required: true,
	min,
	max: 2147483647,
	validate: Number.isSafeInteger,
});
const ProgramSchema = new Schema(
	{
		programType: { type: String, enum: ProgramType, required: true },
		programStatus: { type: String, enum: ProgramStatus, default: ProgramStatus.ACTIVE, required: true },
		programCategory: { type: String, enum: ProgramCategory, required: true },
		programLocation: { type: String, enum: ProgramLocation, required: true },
		programName: { type: String, required: true, minlength: 3, maxlength: 100 },
		programAddress: { type: String, minlength: 3, maxlength: 100 },
		programPrice: integer(0),
		programDuration: integer(1),
		programCapacity: integer(1),
		programImages: { type: [String], required: true, validate: (images: string[]) => images.length > 0 },
		programDesc: { type: String, minlength: 5, maxlength: 500 },
		programViews: { type: Number, default: 0, min: 0 },
		programLikes: { type: Number, default: 0, min: 0 },
		programRank: { type: Number, default: 0, min: 0 },
		memberId: { type: Schema.Types.ObjectId, required: true, ref: 'Member' },
		deletedAt: Date,
	},
	{ timestamps: true, collection: 'programs' },
);
ProgramSchema.pre('validate', function () {
	assertProgram(this.toObject());
});
ProgramSchema.index({ programStatus: 1, programLocation: 1, programType: 1, programCategory: 1 });
ProgramSchema.index({ memberId: 1, programStatus: 1, createdAt: -1 });
export default ProgramSchema;
