const form = document.querySelector('#screeningForm');
const resultPanel = document.querySelector('#screeningResult');
const errorPanel = document.querySelector('#formError');
const screeningLayout = document.querySelector('#screeningLayout');
const screeningSideNote = document.querySelector('#screeningSideNote');
const workflowStatus = document.querySelector('#workflowStatus');
const progressSteps = [...document.querySelectorAll('.workflow-progress li')];
const workflowPanels = [
    document.querySelector('#screeningStepSymptoms'),
    document.querySelector('#screeningStepHistory'),
    resultPanel,
    document.querySelector('#cancerInformationStep'),
    document.querySelector('#facilityStep')
];
const workflowStepNames = [
    'Symptoms',
    'Health history',
    'Result',
    'Cancer information',
    'Facilities'
];
const facilityDirectory = JSON.parse(
    document.querySelector('#facilityDirectoryData').textContent
);
const facilitySearchForm = document.querySelector('#facilitySearchForm');
const facilityCityInput = document.querySelector('#facilityCity');
const facilitySearchStatus = document.querySelector('#facilitySearchStatus');
const facilityResults = document.querySelector('#facilityResults');
const supportedCities = document.querySelector('#supportedCities');
const demoOncologists = document.querySelector('#demoOncologists');

function showWorkflowStep(index, shouldFocus = true) {
    workflowPanels.forEach((panel, panelIndex) => {
        panel.hidden = panelIndex !== index;
    });
    screeningLayout.hidden = index > 1;
    screeningLayout.classList.toggle('is-single-column', index === 1);
    screeningSideNote.hidden = index === 1;
    workflowStatus.textContent =
        `Step ${index + 1} of ${workflowPanels.length}: ${workflowStepNames[index]}`;

    progressSteps.forEach((step, stepIndex) => {
        if (stepIndex === index) {
            step.setAttribute('aria-current', 'step');
        } else {
            step.removeAttribute('aria-current');
        }
    });

    if (shouldFocus) {
        document.querySelector('#main').scrollIntoView({behavior: 'smooth', block: 'start'});
        workflowPanels[index].focus({preventScroll: true});
    }
}

facilityDirectory.city_centres.forEach(city => {
    const option = document.createElement('option');
    option.value = city.name;
    supportedCities.appendChild(option);
});

facilityDirectory.demo_oncologists.forEach(oncologist => {
    const item = document.createElement('li');
    item.textContent = `${oncologist.name} — ${oncologist.note}`;
    demoOncologists.appendChild(item);
});

function getScreeningPayload(formData) {
    const rawAge = formData.get('age');
    const urgentAnswer = formData.get('urgent_now');

    return {
        symptoms: formData.getAll('symptoms'),
        urgent_now: urgentAnswer === 'true',
        age: rawAge === '' ? null : Number(rawAge),
        sex: formData.get('sex') || null,
        smoking: formData.get('smoking') || null,
        alcohol: formData.get('alcohol') || null,
        family_history: formData.get('family_history') || null,
        previous_diagnosis: formData.get('previous_diagnosis') || null
    };
}

function renderSources(sources) {
    const list = document.querySelector('#resultSources');
    list.replaceChildren();

    sources.forEach(source => {
        const url = new URL(source.url);
        if (url.protocol !== 'https:') {
            return;
        }

        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = url.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = `${source.organization}: ${source.title}`;
        item.appendChild(link);
        list.appendChild(item);
    });
}

function distanceInKm(origin, destination) {
    const radians = degrees => degrees * Math.PI / 180;
    const latitudeDelta = radians(destination.latitude - origin.latitude);
    const longitudeDelta = radians(destination.longitude - origin.longitude);
    const originLatitude = radians(origin.latitude);
    const destinationLatitude = radians(destination.latitude);
    const haversine = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(originLatitude) * Math.cos(destinationLatitude)
        * Math.sin(longitudeDelta / 2) ** 2;

    return 6371 * 2 * Math.atan2(
        Math.sqrt(haversine),
        Math.sqrt(1 - haversine)
    );
}

function renderFacilitySearchResults(city) {
    const normalizedCity = facilityCityInput.value.trim().toLocaleLowerCase();
    const selectedCity = facilityDirectory.city_centres.find(candidate =>
        candidate.name.toLocaleLowerCase() === normalizedCity
        || candidate.aliases.some(alias => alias.toLocaleLowerCase() === normalizedCity)
    );

    facilityResults.replaceChildren();
    if (!selectedCity) {
        const cityNames = facilityDirectory.city_centres
            .map(candidate => candidate.name)
            .join(', ');
        facilitySearchStatus.textContent =
            `No match for "${city}". Choose a listed city: ${cityNames}.`;
        return;
    }

    const nearestFacilities = facilityDirectory.facilities
        .map(facility => ({
            ...facility,
            distance: distanceInKm(selectedCity, facility)
        }))
        .sort((first, second) => first.distance - second.distance)
        .slice(0, 3);

    facilitySearchStatus.textContent =
        `Closest listed facilities to ${selectedCity.name}, sorted by approximate straight-line distance from the city centre:`;

    nearestFacilities.forEach(facility => {
        const card = document.createElement('article');
        card.className = 'facility-card';

        const title = document.createElement('h3');
        title.textContent = facility.name;
        const location = document.createElement('p');
        location.textContent = facility.city;
        const distance = document.createElement('p');
        distance.textContent = `About ${Math.round(facility.distance)} km from ${selectedCity.name} city centre`;
        const mapLink = document.createElement('a');
        mapLink.href = facility.map_url;
        mapLink.target = '_blank';
        mapLink.rel = 'noopener noreferrer';
        mapLink.textContent = 'View map';

        card.append(title, location, distance, mapLink);
        facilityResults.appendChild(card);
    });
}

function renderResult(result) {
    const actionLabels = {
        urgent_care: 'Urgent care',
        clinician_assessment: 'Arrange a health-worker assessment',
        screening_discussion: 'Discuss local screening options'
    };

    resultPanel.dataset.action = result.action;
    document.querySelector('#resultAction').textContent =
        actionLabels[result.action] || 'Recommended next step';
    document.querySelector('#resultNextStep').textContent = result.next_step;
    document.querySelector('#discussionPrompt').textContent = result.discussion_prompt;
    document.querySelector('#resultDisclaimer').textContent = result.disclaimer;
    document.querySelector('#resultPrivacy').textContent = result.privacy_notice;

    const symptomList = document.querySelector('#selectedSymptoms');
    const symptomBlock = document.querySelector('#selectedSymptomsBlock');
    symptomList.replaceChildren();
    result.selected_symptoms.forEach(symptom => {
        const item = document.createElement('li');
        item.textContent = symptom;
        symptomList.appendChild(item);
    });
    symptomBlock.hidden = result.selected_symptoms.length === 0;
    renderSources(result.sources);

    showWorkflowStep(2);
}

facilitySearchForm.addEventListener('submit', event => {
    event.preventDefault();
    renderFacilitySearchResults(facilityCityInput.value);
});

async function submitScreening() {
    if (!form.reportValidity()) {
        return;
    }
    errorPanel.hidden = true;

    try {
        const response = await fetch('/screening/results', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(getScreeningPayload(new FormData(form)))
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Unable to process your answers.');
        }
        renderResult(result);
    } catch (error) {
        errorPanel.textContent = error.message || 'Unable to process your answers. Please try again.';
        errorPanel.hidden = false;
        errorPanel.focus();
    }
}

form.addEventListener('submit', event => {
    event.preventDefault();
    submitScreening();
});

document.querySelector('#continueToHistory').addEventListener('click', () => {
    if (form.reportValidity()) {
        showWorkflowStep(1);
    }
});

document.querySelector('#backToSymptoms').addEventListener('click', () => showWorkflowStep(0));
document.querySelector('#skipHistory').addEventListener('click', submitScreening);
document.querySelector('#backToHistory').addEventListener('click', () => showWorkflowStep(1));
document.querySelector('#showCancerInformation').addEventListener('click', () => showWorkflowStep(3));
document.querySelector('#showFacilitiesFromResult').addEventListener('click', () => showWorkflowStep(4));
document.querySelector('#backToResult').addEventListener('click', () => showWorkflowStep(2));
document.querySelector('#showFacilities').addEventListener('click', () => showWorkflowStep(4));
document.querySelector('#backToCancerInformation').addEventListener('click', () => showWorkflowStep(3));

function clearWorkflow() {
    form.reset();
    errorPanel.hidden = true;
    facilityCityInput.value = '';
    facilitySearchStatus.textContent = '';
    facilityResults.replaceChildren();
    resultPanel.dataset.action = '';
    document.querySelector('#resultAction').textContent = '';
    document.querySelector('#resultNextStep').textContent = '';
    document.querySelector('#discussionPrompt').textContent = '';
    document.querySelector('#resultDisclaimer').textContent = '';
    document.querySelector('#resultPrivacy').textContent = '';
    document.querySelector('#selectedSymptoms').replaceChildren();
    document.querySelector('#selectedSymptomsBlock').hidden = true;
    document.querySelector('#resultSources').replaceChildren();
    showWorkflowStep(0);
    document.querySelector('#screeningForm input[name="symptoms"]').focus();
}

document.querySelectorAll('.clear-answers').forEach(button => {
    button.addEventListener('click', clearWorkflow);
});

showWorkflowStep(0, false);

const navToggle = document.querySelector('.nav-toggle');
const navigation = document.querySelector('.site-nav');

navToggle.addEventListener('click', () => {
    const isExpanded = navToggle.getAttribute('aria-expanded') === 'true';
    navToggle.setAttribute('aria-expanded', String(!isExpanded));
    navToggle.setAttribute('aria-label', isExpanded ? 'Open navigation' : 'Close navigation');
    navigation.classList.toggle('is-open', !isExpanded);
});

navigation.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
        navigation.classList.remove('is-open');
        navToggle.setAttribute('aria-expanded', 'false');
        navToggle.setAttribute('aria-label', 'Open navigation');
    });
});
