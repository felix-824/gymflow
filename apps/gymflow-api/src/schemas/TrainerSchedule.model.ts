import { Schema } from 'mongoose';
import { TrainerScheduleDayOfWeek, TRAINER_SCHEDULE_TIME_PATTERN } from '../libs/enums/trainer-schedule.enum';
import { assertTrainerScheduleDay } from '../libs/trainer-schedule.validation';

const TrainerScheduleSchema = new Schema(
	{
		memberId: { type: Schema.Types.ObjectId, required: true, ref: 'Member', immutable: true },
		dayOfWeek: { type: String, enum: TrainerScheduleDayOfWeek, required: true, immutable: true },
		startTime: { type: String, minlength: 5, maxlength: 5, match: TRAINER_SCHEDULE_TIME_PATTERN },
		endTime: { type: String, minlength: 5, maxlength: 5, match: TRAINER_SCHEDULE_TIME_PATTERN },
		isAvailable: { type: Boolean, required: true },
	},
	{ timestamps: true, collection: 'trainerSchedules' },
);
TrainerScheduleSchema.pre('validate', function () {
	assertTrainerScheduleDay(this.toObject());
});
TrainerScheduleSchema.index({ memberId: 1, dayOfWeek: 1 }, { unique: true });
export default TrainerScheduleSchema;
