import Patient from './Patient';
import Practitioner from './Practitioner';
import Resource from './Resource';
import _ from 'lodash';
import moment from 'moment';

// Wrap our usage of fhirclient with some simple utilities

// fhirclient seems pretty broken from this perspective, it doesn't
// export anything and it puts FHIR in window; work around for now
import nothing from 'fhirclient'; // eslint-disable-line no-unused-vars
const FHIR = window.FHIR;

// Some common functions for both basic FHIR and within a SMART context

// Given a SMART context and a search string (which can be blank), returns a promise
// that provides a list of patients loaded from the server
const loadPatients = (smart, searchString) => {
  const searchParams = { type: 'Patient' };
  if (searchString.length > 0) {
    searchParams.query = { name: searchString };
  }
  return smart.api.search(searchParams).then((result) => {
    return result.data.entry.map((entry) => new Patient(entry.resource));
  });
}

const loadResources = (smart, patientId) => {
  const getResources = (type) => {
    // We need to wrap the results of smart.api.search with a real promise, using the jQuery
    // promise directly results in unexpected behavior
    return new Promise((resolve) => {
      return smart.api.search({ type: type, query: { patient: patientId } }).then((response) => {
        if (response.data.entry) {
          const resources = response.data.entry.map((entry) => Resource.wrap(entry.resource));
          resolve(_.sortBy(resources, (resource) => moment(resource.startDate)).reverse());
        } else {
          resolve([]);
        }
      }, (error) => {
        resolve([]); // Eat errors for the moment
      });
    });
  };

  // MedicationRequests might have information on which medication in a separate resource
  const withMedications = (medicationRequests) => {
    return Promise.all(medicationRequests.map((medicationRequest) => medicationRequest.withMedication(smart)));
  }

  return Promise.all([getResources('Condition'),
                      getResources('MedicationRequest').then(withMedications),
                      getResources('Procedure'),
                      getResources('Observation')]);
}


const FHIRWrap = {

  // Given a FHIR server URL and a search string (which can be blank), returns a promise
  // that provides a list of patients loaded from the server
  loadPatients(fhirServer, searchString) {
    const smart = FHIR.client({ serviceUrl: fhirServer });
    return loadPatients(smart, searchString);
  },

  // Given a FHIR server URL and a patient, returns a promise that provides the patient's
  // conditions, medications, procedures, and observations loaded from the server
  loadResources(fhirServer, patientId) {
    const smart = FHIR.client({ serviceUrl: fhirServer });
    return loadResources(smart, patientId);
  }
}

const SMARTWrap = {

  // Given a search string (which can be blank), returns a promise
  // that provides a list of patients loaded from the server
  loadPatients(searchString) {
    return new Promise((resolve) => {
      FHIR.oauth2.ready((smart) => {
        loadPatients(smart, searchString).then((result) => resolve(result));
      });
    });
  },

  // Given a patient, returns a promise that provides the patient's conditions,
  // medications, procedures, and observations loaded from the server
  loadResources(patientId) {
    return new Promise((resolve) => {
      FHIR.oauth2.ready((smart) => {
        loadResources(smart, patientId).then((result) => resolve(result));
      });
    });
  },

  // Return a promise that, if the app is loaded in a SMART context, provides the loaded
  // user, patient, conditions, medications, procedures, and observations
  load() {
    return new Promise((resolve, reject) => {
      FHIR.oauth2.ready((smart) => {
        const user = smart.user.read();
        const patient = smart.patient.read();
        const resources = FHIRWrap.loadResources(smart.server.serviceUrl, smart.patient.id);
        Promise.all([user, patient, resources]).then(([user, patient, resources]) => {
          patient = new Patient(patient);
          user = new Practitioner(user);
          resolve([user, patient].concat(resources));
        }).catch((e) => reject(e));
      });
    });
  }
}

export { SMARTWrap, FHIRWrap };
