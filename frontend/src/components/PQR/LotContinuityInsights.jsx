import React from 'react';
import LotContinuityExecutiveSummary from './continuity/LotContinuityExecutiveSummary';
import LotContinuityScatterCard from './continuity/LotContinuityScatterCard';
import LotContinuityDefectBreakdownCard from './continuity/LotContinuityDefectBreakdownCard';
import LotPredictionMethodologyCard from './continuity/LotPredictionMethodologyCard';

const LotContinuityInsights = ({
    overview,
    analysisQuality,
    executiveSummary,
    defectBreakdown,
    continuityMap,
    predictionModel
}) => {
    if (!overview?.buckets?.length) return null;

    return (
        <div className="px-5 pb-4 space-y-4">
            <LotContinuityExecutiveSummary
                overview={overview}
                analysisQuality={analysisQuality}
                executiveSummary={executiveSummary}
            />
            <LotPredictionMethodologyCard predictionModel={predictionModel} />
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <LotContinuityScatterCard
                    overview={overview}
                    continuityMap={continuityMap}
                />
                <LotContinuityDefectBreakdownCard
                    defectBreakdown={defectBreakdown}
                />
            </div>
        </div>
    );
};

export default LotContinuityInsights;
