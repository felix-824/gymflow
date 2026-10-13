import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TrainerSchedule } from '../../libs/dto/trainer-schedule/trainer-schedule';
import { TrainerScheduleInput } from '../../libs/dto/trainer-schedule/trainer-schedule.input';
import { trainerScheduleWeekdays } from '../../libs/enums/trainer-schedule.enum';
import { assertWeeklyTrainerSchedule } from '../../libs/trainer-schedule.validation';

@Injectable()
export class TrainerScheduleService {
	constructor(@InjectModel('TrainerSchedule') private readonly trainerScheduleModel: Model<TrainerSchedule>) {}

	private orderWeek(entries: TrainerSchedule[]): TrainerSchedule[] {
		return entries.sort(
			(left, right) =>
				trainerScheduleWeekdays.indexOf(left.dayOfWeek) - trainerScheduleWeekdays.indexOf(right.dayOfWeek),
		);
	}

	public async getMyTrainerSchedule(memberId: Types.ObjectId): Promise<TrainerSchedule[]> {
		return this.orderWeek(await this.trainerScheduleModel.find({ memberId }).lean().exec());
	}

	public async saveMyTrainerSchedule(
		memberId: Types.ObjectId,
		input: TrainerScheduleInput,
	): Promise<TrainerSchedule[]> {
		// Validate the whole snapshot before collection initialization or any writes.
		assertWeeklyTrainerSchedule(input);
		const operations = input.days.map((day) => ({
			updateOne: {
				filter: { memberId, dayOfWeek: day.dayOfWeek },
				update: {
					$set: {
						isAvailable: day.isAvailable,
						...(day.startTime != null ? { startTime: day.startTime, endTime: day.endTime } : {}),
					},
					$setOnInsert: { memberId, dayOfWeek: day.dayOfWeek },
				},
				upsert: true,
			},
		}));
		// Ensure the collection and uniqueness index exist before entering the transaction.
		await this.trainerScheduleModel.init();
		try {
			return await this.trainerScheduleModel.db.transaction(async (session) => {
				await this.trainerScheduleModel.bulkWrite(operations, { session, ordered: true });
				const entries = await this.trainerScheduleModel.find({ memberId }).session(session).lean().exec();
				return this.orderWeek(entries);
			});
		} catch (error: unknown) {
			if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000)
				throw new ConflictException('Schedule changed concurrently; reload and retry');
			throw error;
		}
	}
}
