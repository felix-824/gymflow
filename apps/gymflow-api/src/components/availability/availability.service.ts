import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProgramAvailabilityInquiry } from '../../libs/dto/availability/availability.input';
import { AvailableSlot } from '../../libs/dto/availability/availability';
import { Reservation } from '../../libs/dto/reservation/reservation';
import { ProgramType } from '../../libs/enums/program.enum';
import { shapeIntoMongoObjectId } from '../../libs/config';
import {
	assertAvailabilityDate,
	capacityOccupyingStatuses,
	findAvailableSlots,
	getAvailabilityWeekday,
	getSeoulDateTime,
} from '../../libs/availability';
import { ProgramService } from '../program/program.service';
import { TrainerScheduleService } from '../trainer-schedule/trainer-schedule.service';

@Injectable()
export class AvailabilityService {
	constructor(
		@InjectModel('Reservation') private readonly reservationModel: Model<Reservation>,
		private readonly programService: ProgramService,
		private readonly trainerScheduleService: TrainerScheduleService,
	) {}

	public async getProgramAvailability(input: ProgramAvailabilityInquiry): Promise<AvailableSlot[]> {
		const programId = shapeIntoMongoObjectId(input.programId);
		const now = getSeoulDateTime(new Date());
		assertAvailabilityDate(input.reservationDate, now);
		// Passing null preserves the public visibility checks without recording a view.
		const program = await this.programService.getProgram(null, programId);
		if (program.programType === ProgramType.ONLINE) return [];
		const weekday = getAvailabilityWeekday(input.reservationDate);
		const week = await this.trainerScheduleService.getMyTrainerSchedule(program.memberId);
		const schedule = week.find((day) => day.dayOfWeek === weekday);
		if (!schedule || !schedule.isAvailable) return [];
		const reservations = await this.reservationModel
			.find({
				trainerId: program.memberId,
				reservationDate: input.reservationDate,
				reservationStatus: { $in: capacityOccupyingStatuses },
			})
			.select('programId reservationDate startTime endTime reservationStatus -_id')
			.lean()
			.exec();
		return findAvailableSlots(program, schedule, input.reservationDate, reservations, now);
	}
}
