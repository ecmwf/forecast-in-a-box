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