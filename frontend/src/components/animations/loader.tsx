
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

import styles from './loader.module.css';

const Loader = () => {
    return (
        <div className={styles.container}>
            <div className={styles.cloud + ' ' + styles.front}>
                <span className={styles['left-front']}></span>
                <span className={styles['right-front']}></span>
            </div>
            <span className={styles.sun + ' ' + styles.sunshine}></span>
            <span className={styles.sun}></span>
            <div className={styles.cloud + ' ' + styles.back}>
                <span className={styles['left-back']}></span>
                <span className={styles['right-back']}></span>
            </div>
        </div>
    );
};

export default Loader;
