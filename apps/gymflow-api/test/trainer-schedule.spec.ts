import 'reflect-metadata';
import { Model, Types, createConnection } from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import TrainerScheduleSchema from '../src/schemas/TrainerSchedule.model';
import { TrainerSchedule } from '../src/libs/dto/trainer-schedule/trainer-schedule';
import { TrainerScheduleInput } from '../src/libs/dto/trainer-schedule/trainer-schedule.input';
import { TrainerScheduleDayOfWeek, trainerScheduleWeekdays } from '../src/libs/enums/trainer-schedule.enum';
import { assertTrainerScheduleDay, assertWeeklyTrainerSchedule } from '../src/libs/trainer-schedule.validation';
import { TrainerScheduleService } from '../src/components/trainer-schedule/trainer-schedule.service';

const week = (): TrainerScheduleInput => ({
	days: trainerScheduleWeekdays.map((dayOfWeek) => ({ dayOfWeek, isAvailable: false })),
});

describe('Trainer schedule validation without a database', () => {
	it.each(['9:00', '25:00', '12:75', '09', 'abc', '09:00\n', ' 09:00', '24:00'])(
		'rejects malformed time %j before starting a write',
		async (startTime) => {
			const input = week();
			input.days[0] = { dayOfWeek: TrainerScheduleDayOfWeek.MON, isAvailable: true, startTime, endTime: '18:00' };
			const init = jest.fn();
			const transaction = jest.fn();
			const service = new TrainerScheduleService({ init, db: { transaction } } as unknown as Model<TrainerSchedule>);
			await expect(service.saveMyTrainerSchedule(new Types.ObjectId(), input)).rejects.toThrow(BadRequestException);
			expect(init).not.toHaveBeenCalled();
			expect(transaction).not.toHaveBeenCalled();
		},
	);
	it.each([
		['18:00', '09:00'],
		['10:00', '10:00'],
	])('rejects non-increasing range %s to %s', (startTime, endTime) => {
		expect(() =>
			assertTrainerScheduleDay({ dayOfWeek: TrainerScheduleDayOfWeek.MON, isAvailable: true, startTime, endTime }),
		).toThrow(BadRequestException);
	});
	it('validates weekday coverage, boolean availability, required pairs and disabled stored hours', () => {
		expect(() => assertWeeklyTrainerSchedule({ days: [] })).toThrow('exactly seven');
		const duplicate = week();
		duplicate.days[6].dayOfWeek = TrainerScheduleDayOfWeek.MON;
		expect(() => assertWeeklyTrainerSchedule(duplicate)).toThrow('Duplicate');
		expect(() => assertTrainerScheduleDay({ dayOfWeek: 'OTHER', isAvailable: false })).toThrow('weekday');
		expect(() => assertTrainerScheduleDay({ dayOfWeek: 'MON', isAvailable: 'false' })).toThrow('boolean');
		expect(() => assertTrainerScheduleDay({ dayOfWeek: 'MON', isAvailable: true })).toThrow('HH:mm');
		expect(() => assertTrainerScheduleDay({ dayOfWeek: 'MON', isAvailable: false, startTime: '09:00' })).toThrow(
			'both',
		);
		expect(() =>
			assertTrainerScheduleDay({ dayOfWeek: 'MON', isAvailable: false, startTime: '18:00', endTime: '09:00' }),
		).toThrow('before');
		expect(() =>
			assertTrainerScheduleDay({ dayOfWeek: 'MON', isAvailable: false, startTime: null, endTime: null }),
		).not.toThrow();
		expect(() =>
			assertTrainerScheduleDay({ dayOfWeek: 'MON', isAvailable: true, startTime: '00:00', endTime: '23:59' }),
		).not.toThrow();
	});
	it('validates nested GraphQL DTO entries', async () => {
		const input = plainToInstance(TrainerScheduleInput, {
			days: week().days.map((day) => ({ ...day, isAvailable: 'yes' })),
		});
		expect(await validate(input)).not.toHaveLength(0);
		expect(await validate(plainToInstance(TrainerScheduleInput, week()))).toHaveLength(0);
	});
	it('applies the same cross-field rule in the real Mongoose schema', async () => {
		const connection = createConnection();
		try {
			const schedules = connection.model<TrainerSchedule>('TrainerSchedule', TrainerScheduleSchema);
			await expect(
				new schedules({
					memberId: new Types.ObjectId(),
					dayOfWeek: 'MON',
					isAvailable: true,
					startTime: '18:00',
					endTime: '09:00',
				}).validate(),
			).rejects.toThrow('before');
			await expect(
				new schedules({ memberId: new Types.ObjectId(), dayOfWeek: 'MON', isAvailable: false }).validate(),
			).resolves.toBeUndefined();
			expect(TrainerScheduleSchema.indexes()).toContainEqual([
				{ memberId: 1, dayOfWeek: 1 },
				expect.objectContaining({ unique: true }),
			]);
		} finally {
			await connection.close();
		}
	});
});
